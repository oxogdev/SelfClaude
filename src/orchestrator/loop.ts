import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeTurn } from '../claude-code/spawn.js';
import { extractAssistantText, type StreamEvent } from './stream-parser.js';
import { extractDeveloperTasks } from './tag-parser.js';
import { extractSignals, type SignalKind } from './signals.js';
import type { Phase } from './state-machine.js';
import type { Orchestrator } from './index.js';
import { log } from '../lib/log.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUP_PROMPT_PATH = resolve(HERE, '..', 'claude-code', 'system-prompts', 'supervisor.md');
let cachedSupervisorPrompt: string | null = null;

export function loadSupervisorSystemPrompt(): string {
  if (cachedSupervisorPrompt) return cachedSupervisorPrompt;
  cachedSupervisorPrompt = readFileSync(SUP_PROMPT_PATH, 'utf8');
  return cachedSupervisorPrompt;
}

const SIGNAL_TO_PHASE: Partial<Record<SignalKind, Phase>> = {
  'discovery-complete': 'docs',
  'ready-to-execute': 'phase-loop',
};

export interface LoopRunOptions {
  orchestrator: Orchestrator;
  userPrompt: string;
  supervisorSessionId?: string;
  developerSessionId?: string;
  supervisorSystemPrompt?: string;
  developerSystemPrompt?: string;
  onSupervisorEvent?: (e: StreamEvent) => void;
  onDeveloperEvent?: (e: StreamEvent) => void;
}

export interface LoopTurnResult {
  supervisorSessionId: string | null;
  developerSessionId: string | null;
  supervisorText: string;
  supervisorRemainingText: string;
  tasksDelegated: number;
  developerExecuted: boolean;
  developerText: string;
  /** Phase signals extracted from the supervisor's text this turn. */
  signals: SignalKind[];
  /** Phase the orchestrator is in after this turn (post-signal application). */
  phase: Phase;
}

function collectAssistantText(events: StreamEvent[]): string {
  return events
    .filter((e) => e.type === 'assistant')
    .map(extractAssistantText)
    .filter((t) => t.length > 0)
    .join('\n');
}

/**
 * Run one round of the dual-agent loop:
 *   user → supervisor → (extract <TASK_FOR_DEVELOPER>) → developer → report → supervisor inbox.
 *
 * The caller is responsible for calling this again with the returned session
 * IDs to keep the conversation going. Continuous looping (with discovery
 * gating, ask_user pauses, etc.) is layered on top in M7+.
 */
export async function runDualAgentTurn(opts: LoopRunOptions): Promise<LoopTurnResult> {
  const orch = opts.orchestrator;
  const ws = orch.getWorkspace();
  const supSystemPrompt = opts.supervisorSystemPrompt ?? loadSupervisorSystemPrompt();

  orch.dispatch({ kind: 'sup-turn-start' });
  const supResult = await runClaudeTurn(
    {
      role: 'supervisor',
      cwd: ws.cwd,
      prompt: opts.userPrompt,
      resumeSessionId: opts.supervisorSessionId,
      settingsPath: ws.settingsPath,
      mcpConfig: ws.mcpConfigPath,
      systemPromptAppend: supSystemPrompt,
      envOverrides: orch.hookEnv('supervisor'),
      enableChrome: false,
    },
    opts.onSupervisorEvent,
  );
  const supervisorText = collectAssistantText(supResult.events);
  const { signals, remainingText: textAfterSignals } = extractSignals(supervisorText);
  const { tasks, remainingText } = extractDeveloperTasks(textAfterSignals);
  log('info', 'loop.supervisor.parsed', {
    tasks: tasks.length,
    signals,
    sessionId: supResult.sessionId,
  });
  orch.dispatch({ kind: 'sup-turn-end' });

  // Apply phase signals (set-phase events). Order matters: discovery-complete
  // → docs, ready-to-execute → phase-loop. If both fire in one turn we end
  // up in phase-loop, which is the most-advanced state and matches intent.
  for (const sig of signals) {
    const phase = SIGNAL_TO_PHASE[sig];
    if (phase) {
      orch.dispatch({ kind: 'set-phase', phase });
    }
  }

  let developerExecuted = false;
  let developerText = '';
  let developerSessionId = opts.developerSessionId ?? null;

  if (tasks.length > 0) {
    for (const t of tasks) {
      orch.messages.enqueue({ to: 'developer', source: 'supervisor', body: t });
    }
    orch.dispatch({ kind: 'dev-turn-start' });
    const devResult = await runClaudeTurn(
      {
        role: 'developer',
        cwd: ws.cwd,
        prompt:
          'You have a new task in your context (injected by the supervisor). ' +
          'Read it carefully, execute it using the tools available, and ' +
          'when done summarize what you did in your final reply.',
        resumeSessionId: developerSessionId ?? undefined,
        settingsPath: ws.settingsPath,
        systemPromptAppend: opts.developerSystemPrompt,
        permissionMode: 'acceptEdits',
        envOverrides: orch.hookEnv('developer'),
        enableChrome: false,
      },
      opts.onDeveloperEvent,
    );
    developerSessionId = devResult.sessionId ?? developerSessionId;
    developerText = collectAssistantText(devResult.events);
    if (developerText) {
      orch.messages.enqueue({
        to: 'supervisor',
        source: 'developer',
        body: `DEVELOPER_REPORT:\n${developerText}`,
      });
    }
    developerExecuted = true;
    orch.dispatch({ kind: 'dev-turn-end' });
  }

  const finalState = orch.getState();
  const finalPhase: Phase =
    finalState.tag === 'shutdown' ? 'shutdown' : finalState.phase;

  // Persist the new session ids and phase so a future `selfclaude start`
  // resumes from here. We only persist workflow phases (no `paused`/`shutdown`).
  if (finalPhase === 'discovery' || finalPhase === 'docs' || finalPhase === 'phase-loop') {
    await orch.updateProjectState({
      phase: finalPhase,
      supervisorSessionId: supResult.sessionId ?? orch.getProjectState().supervisorSessionId,
      developerSessionId: developerSessionId ?? orch.getProjectState().developerSessionId,
    });
  }

  return {
    supervisorSessionId: supResult.sessionId ?? null,
    developerSessionId,
    supervisorText,
    supervisorRemainingText: remainingText,
    tasksDelegated: tasks.length,
    developerExecuted,
    developerText,
    signals,
    phase: finalPhase,
  };
}
