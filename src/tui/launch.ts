import { createElement } from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { runDemo } from './demo.js';
import { useTuiStore } from './store.js';
import type {
  Orchestrator,
  PendingApprovalView,
  PendingQuestionView,
  StartResult,
} from '../orchestrator/index.js';
import {
  extractAssistantText,
  type StreamEvent,
} from '../orchestrator/stream-parser.js';
import { runDualAgentTurn } from '../orchestrator/loop.js';
import { parseApprovalReply } from '../telegram/parser.js';
import type { FsmState } from '../orchestrator/state-machine.js';

function handleUserInputDemo(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const s = useTuiStore.getState();
  if (s.pendingQuestion) {
    s.appendSupervisor({ kind: 'user', text: trimmed, ts: Date.now() });
    s.appendSupervisor({
      kind: 'system',
      text: `(answered question "${s.pendingQuestion.id}")`,
      ts: Date.now(),
    });
    s.setQuestion(null);
    s.setSupervisorActive(false);
    return;
  }
  if (s.pendingApproval) {
    const decision = trimmed.toLowerCase().startsWith('y') ? 'allow' : 'deny';
    s.appendSupervisor({
      kind: 'system',
      text: `(approval ${decision} for "${s.pendingApproval.action}")`,
      ts: Date.now(),
    });
    s.setApproval(null);
    return;
  }
  s.appendSupervisor({ kind: 'user', text: trimmed, ts: Date.now() });
}

export async function startDemo(): Promise<void> {
  const instance = render(
    createElement(App, {
      onUserInput: handleUserInputDemo,
      onExit: () => undefined,
    }),
  );
  runDemo();
  await instance.waitUntilExit();
}

interface AssistantContent {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
}

function describeToolUse(c: AssistantContent): string | null {
  if ((c as { type?: unknown }).type !== 'tool_use') return null;
  const name = String(c.name ?? '?');
  const input = (c.input ?? {}) as Record<string, unknown>;
  if (name === 'Bash') {
    const cmd = String(input.command ?? '');
    return `${name}: ${cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd}`;
  }
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return `${name}: ${input.file_path ?? '?'}`;
  }
  return name;
}

function pumpStreamEventsToTui(role: 'supervisor' | 'developer', e: StreamEvent): void {
  const s = useTuiStore.getState();
  if (e.type !== 'assistant') return;
  const msg = (e as { message?: { content?: AssistantContent[] } }).message;
  const content = msg?.content;
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c.type === 'text' && typeof c.text === 'string' && c.text) {
      if (role === 'supervisor') {
        s.appendSupervisor({ kind: 'supervisor', text: c.text, ts: Date.now() });
      } else {
        s.appendDeveloper({ kind: 'text', payload: c.text, ts: Date.now() });
      }
    } else if (c.type === 'tool_use') {
      const summary = describeToolUse(c);
      if (summary) {
        s.appendDeveloper({ kind: 'tool', payload: summary, ts: Date.now() });
      }
    } else if (c.type === 'tool_result') {
      const text = typeof c.text === 'string' ? c.text : '';
      const trimmed = text.length > 80 ? `${text.slice(0, 77)}...` : text;
      if (trimmed) s.appendDeveloper({ kind: 'tool-result', payload: trimmed, ts: Date.now() });
    }
  }
}

/**
 * Start the real interactive TUI bound to a live orchestrator.
 *
 * Wires orchestrator events into the TUI store, dispatches user input as
 * either a question/approval reply or a fresh dual-agent turn, and persists
 * session ids across turns. Returns when the TUI exits.
 */
export async function startInteractive(orch: Orchestrator, start: StartResult): Promise<void> {
  const store = useTuiStore.getState();
  store.setPhase(start.projectState.phase);

  // Bridge orchestrator → TUI store
  orch.on('user-question', (q: PendingQuestionView) => {
    useTuiStore.getState().setQuestion({
      id: q.id,
      text: q.question,
      options: q.options,
    });
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: `(asked: ${q.question})`,
      ts: Date.now(),
    });
  });
  orch.on('user-question-resolved', () => {
    useTuiStore.getState().setQuestion(null);
  });
  orch.on('approval-requested', (a: PendingApprovalView) => {
    useTuiStore.getState().setApproval({
      id: a.id,
      action: a.action,
      reason: a.reason,
    });
  });
  orch.on('approval-resolved', () => {
    useTuiStore.getState().setApproval(null);
  });
  orch.on('state-changed', (s: FsmState) => {
    const tui = useTuiStore.getState();
    tui.setFsmState(s);
    if (s.tag !== 'shutdown') {
      tui.setPhase(s.phase);
    }
    tui.setSupervisorActive(s.tag === 'sup-running');
    tui.setDeveloperActive(s.tag === 'dev-running');
  });
  orch.on('phase-doc-written', (e: { filename: string }) => {
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: `(wrote docs/phases/${e.filename})`,
      ts: Date.now(),
    });
  });

  let supervisorSessionId: string | null = start.projectState.supervisorSessionId;
  let developerSessionId: string | null = start.projectState.developerSessionId;

  if (start.existing) {
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: `(resumed existing project at phase ${start.projectState.phase})`,
      ts: Date.now(),
    });
  } else {
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: '(new project — type a description to start the discovery conversation)',
      ts: Date.now(),
    });
  }

  const handleUserInput = (raw: string): void => {
    void onUserInput(raw);
  };

  const onUserInput = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const tui = useTuiStore.getState();

    if (tui.pendingQuestion) {
      orch.resolveUserQuestion(tui.pendingQuestion.id, trimmed);
      tui.appendSupervisor({ kind: 'user', text: trimmed, ts: Date.now() });
      return;
    }
    if (tui.pendingApproval) {
      const decision = parseApprovalReply(trimmed);
      orch.resolveApproval(tui.pendingApproval.id, decision);
      tui.appendSupervisor({
        kind: 'system',
        text: `(approval ${decision} for ${tui.pendingApproval.action})`,
        ts: Date.now(),
      });
      return;
    }

    // Don't accept new prompts while a turn is running
    if (tui.supervisorActive || tui.developerActive) {
      tui.appendSupervisor({
        kind: 'system',
        text: '(busy — wait for the current turn to finish)',
        ts: Date.now(),
      });
      return;
    }

    tui.appendSupervisor({ kind: 'user', text: trimmed, ts: Date.now() });

    try {
      const turn = await runDualAgentTurn({
        orchestrator: orch,
        userPrompt: trimmed,
        supervisorSessionId: supervisorSessionId ?? undefined,
        developerSessionId: developerSessionId ?? undefined,
        onSupervisorEvent: (e) => pumpStreamEventsToTui('supervisor', e),
        onDeveloperEvent: (e) => pumpStreamEventsToTui('developer', e),
      });
      supervisorSessionId = turn.supervisorSessionId ?? supervisorSessionId;
      developerSessionId = turn.developerSessionId ?? developerSessionId;
    } catch (e) {
      useTuiStore.getState().appendSupervisor({
        kind: 'system',
        text: `error: ${(e as Error).message}`,
        ts: Date.now(),
      });
    }
  };

  const instance = render(
    createElement(App, {
      onUserInput: handleUserInput,
      onExit: () => undefined,
    }),
  );
  await instance.waitUntilExit();
}
