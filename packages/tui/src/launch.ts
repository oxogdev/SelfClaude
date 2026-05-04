import { createElement } from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { runDemo } from './demo.js';
import { useTuiStore } from './store.js';
import {
  extractAssistantText,
  extractDeveloperTasks,
  extractToolResults,
  extractToolUses,
  parseApprovalReply,
  runConversationTurn,
  type FsmState,
  type Orchestrator,
  type PendingApprovalView,
  type PendingQuestionView,
  type StartResult,
  type StreamEvent,
} from '@selfclaude/core';

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CLEAR_HOME = '\x1b[2J\x1b[H';

function enterAltScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(ALT_SCREEN_ON);
    process.stdout.write(CLEAR_HOME);
  }
}

function leaveAltScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(ALT_SCREEN_OFF);
  }
}

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

function describeToolInputForSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') {
    const cmd = String(input.command ?? '');
    return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
  }
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return String(input.file_path ?? '?');
  }
  if (name === 'Grep') {
    return String(input.pattern ?? '?');
  }
  if (name === 'Glob') {
    return String(input.pattern ?? '?');
  }
  // Generic fallback: first short string field
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length < 80) return v;
  }
  return '';
}

export async function startDemo(): Promise<void> {
  enterAltScreen();
  const instance = render(
    createElement(App, {
      onUserInput: handleUserInputDemo,
      onExit: () => leaveAltScreen(),
    }),
  );
  runDemo();
  try {
    await instance.waitUntilExit();
  } finally {
    leaveAltScreen();
  }
}

/**
 * Run interactive TUI bound to a live orchestrator. Wires every orchestrator
 * event into the store, dispatches user input either to a pending prompt or
 * as a fresh dual-agent turn, and persists session ids across turns.
 */
export async function startInteractive(orch: Orchestrator, start: StartResult): Promise<void> {
  enterAltScreen();
  const cleanupExit = () => leaveAltScreen();
  process.once('exit', cleanupExit);

  const store = useTuiStore.getState();
  store.setPhase(start.projectState.phase);
  // Refresh telegram indicator: if a TelegramBridge has been mounted
  // (caller did this), nothing observable here yet; the bridge sets its own
  // indicator via the store directly if we want. For now leave default false
  // — caller can flip if desired.

  // tool_use_id → DevEvent.id, so we can fold tool_result into the same line.
  const pendingTools = new Map<string, string>();
  let lastTaskTagged = -1;

  // Bridge orchestrator → TUI store
  orch.on('user-question', (q: PendingQuestionView) => {
    useTuiStore.getState().setQuestion({
      id: q.id,
      text: q.question,
      options: q.options,
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
    if (s.tag !== 'shutdown') tui.setPhase(s.phase);
    tui.setSupervisorActive(s.tag === 'sup-running');
    tui.setDeveloperActive(s.tag === 'dev-running');
  });
  orch.on('phase-doc-written', (e: { filename: string }) => {
    useTuiStore.getState().appendSupervisor({
      kind: 'phase-doc',
      text: `wrote docs/phases/${e.filename}`,
      ts: Date.now(),
    });
  });

  let supervisorSessionId: string | null = start.projectState.supervisorSessionId;
  let developerSessionId: string | null = start.projectState.developerSessionId;

  if (start.existing) {
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: `resumed existing project at phase ${start.projectState.phase}`,
      ts: Date.now(),
    });
  } else {
    useTuiStore.getState().appendSupervisor({
      kind: 'system',
      text: 'new project — type a description to start the discovery conversation',
      ts: Date.now(),
    });
  }

  const onSupervisorEvent = (e: StreamEvent) => {
    const tui = useTuiStore.getState();
    if (e.type !== 'assistant') return;
    const text = extractAssistantText(e);
    if (!text) return;
    // Detect TASK_FOR_DEVELOPER blocks. Keep the original text in the sup pane
    // (so the user sees exactly what the supervisor said), and emit a marker
    // event into the developer pane summarising each delegated task.
    const { tasks } = extractDeveloperTasks(text);
    tui.appendSupervisor({ kind: 'supervisor', text, ts: Date.now() });
    if (tasks.length > 0 && lastTaskTagged !== tui.currentTurnIndex) {
      lastTaskTagged = tui.currentTurnIndex;
      for (const task of tasks) {
        const firstLine = task.split('\n')[0]!;
        const head = firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
        tui.appendDeveloper({ kind: 'task-marker', summary: `sup→dev: ${head}` });
      }
    }
  };

  const onDeveloperEvent = (e: StreamEvent) => {
    const tui = useTuiStore.getState();
    // Tool calls
    for (const tu of extractToolUses(e)) {
      const labelInput = describeToolInputForSummary(tu.name, tu.input);
      const summary = labelInput ? `${tu.name}: ${labelInput}` : tu.name;
      const eventId = tui.appendDeveloper({
        kind: 'tool',
        summary,
        toolUseId: tu.id,
        toolName: tu.name,
        toolInput: tu.input,
      });
      pendingTools.set(tu.id, eventId);
    }
    // Tool results — fold into the matching tool event
    for (const tr of extractToolResults(e)) {
      const eventId = pendingTools.get(tr.toolUseId);
      if (eventId) {
        tui.updateDeveloperEvent(eventId, {
          toolResultText: tr.text,
          isError: tr.isError,
        });
        pendingTools.delete(tr.toolUseId);
      }
    }
    // Plain assistant text from the developer
    if (e.type === 'assistant') {
      const t = extractAssistantText(e);
      if (t) tui.appendDeveloper({ kind: 'text', summary: t });
    }
  };

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
        text: `approval ${decision}: ${tui.pendingApproval.action}`,
        ts: Date.now(),
      });
      return;
    }

    if (tui.supervisorActive || tui.developerActive) {
      tui.appendSupervisor({
        kind: 'system',
        text: 'busy — wait for the current turn to finish',
        ts: Date.now(),
      });
      return;
    }

    tui.appendSupervisor({ kind: 'user', text: trimmed, ts: Date.now() });
    const turnIndex = tui.bumpTurn();
    tui.appendDeveloper({ kind: 'turn-marker', summary: `── turn ${turnIndex} ──` });

    try {
      const result = await runConversationTurn({
        orchestrator: orch,
        userPrompt: trimmed,
        supervisorSessionId: supervisorSessionId ?? undefined,
        developerSessionId: developerSessionId ?? undefined,
        onSupervisorEvent,
        onDeveloperEvent,
      });
      supervisorSessionId = result.supervisorSessionId ?? supervisorSessionId;
      developerSessionId = result.developerSessionId ?? developerSessionId;
      if (result.endedReason === 'max-iterations') {
        useTuiStore.getState().appendSupervisor({
          kind: 'system',
          text: `(stopped after ${result.iterations} iterations — type to continue)`,
          ts: Date.now(),
        });
      }
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
      onExit: () => leaveAltScreen(),
    }),
  );
  try {
    await instance.waitUntilExit();
  } finally {
    leaveAltScreen();
    process.removeListener('exit', cleanupExit);
  }
}
