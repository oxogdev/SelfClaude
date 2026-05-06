import { runDualAgentTurn, type LoopRunOptions, type LoopTurnResult } from './loop.js';
import { log } from '../lib/log.js';

export interface ConversationOptions extends LoopRunOptions {
  /** Maximum sup→dev iterations before forcing a stop. Default 10. */
  maxIterations?: number;
}

export type ConversationEndedReason =
  | 'idle'
  | 'pending-question'
  | 'pending-approval'
  | 'max-iterations';

export interface ConversationResult {
  iterations: number;
  totalTurns: { supervisor: number; developer: number };
  supervisorSessionId: string | null;
  developerSessionId: string | null;
  /** Per-agent CC session ids carried over the conversation. */
  agentSessions: Record<string, string | null>;
  endedReason: ConversationEndedReason;
  /** Last underlying loop turn — useful for callers that want supervisorText / developerText. */
  lastTurn: LoopTurnResult | null;
}

const SYNTHETIC_CONTINUE_PROMPT =
  'A new DEVELOPER_REPORT is in your context. Review it briefly. ' +
  'If more work is needed, delegate the next concrete step in a <TASK_FOR_DEVELOPER>...</TASK_FOR_DEVELOPER> block. ' +
  'If you need a user decision, call ask_user. ' +
  'If the current phase is complete, emit <<PHASE_COMPLETE>> on a line by itself.';

/**
 * Run a full conversational turn: cycle supervisor → developer → supervisor
 * until something stops the loop (no further developer work, a user prompt
 * is pending, an approval is required, or the iteration cap hits). Each
 * iteration is exactly one supervisor turn (followed by at most one
 * developer turn).
 *
 * Without this wrapper the supervisor "goes to sleep" after the developer
 * reports back — the user has to manually re-prompt for the supervisor
 * to consume the report. Here we drive the loop until idle.
 */
export async function runConversationTurn(opts: ConversationOptions): Promise<ConversationResult> {
  const max = opts.maxIterations ?? 10;
  const orch = opts.orchestrator;

  let supSession = opts.supervisorSessionId;
  // Carry per-agent session ids across iterations so each specialist
  // resumes its conversation rather than starting fresh.
  const agentSessions: Record<string, string | null> = {
    ...(opts.agentSessions ?? {}),
  };
  if (opts.developerSessionId && !agentSessions.developer) {
    agentSessions.developer = opts.developerSessionId;
  }
  let prompt = opts.userPrompt;
  let iter = 0;
  let supTurns = 0;
  let devTurns = 0;
  let lastTurn: LoopTurnResult | null = null;
  let endedReason: ConversationEndedReason = 'idle';

  while (iter < max) {
    const turn = await runDualAgentTurn({
      ...opts,
      userPrompt: prompt,
      supervisorSessionId: supSession ?? undefined,
      agentSessions,
    });
    lastTurn = turn;
    supSession = turn.supervisorSessionId ?? supSession;
    Object.assign(agentSessions, turn.agentSessions);
    supTurns += 1;
    if (turn.developerExecuted) devTurns += 1;
    iter += 1;

    if (orch.listPendingQuestions().length > 0) {
      endedReason = 'pending-question';
      break;
    }
    if (orch.listPendingApprovals().length > 0) {
      endedReason = 'pending-approval';
      break;
    }
    if (!turn.anyAgentExecuted) {
      endedReason = 'idle';
      break;
    }
    // At least one agent (developer or specialist) just executed; their
    // report is now queued in the supervisor's inbox. Re-call the
    // supervisor with a synthetic prompt so the next turn drains the
    // inbox and decides what to do next.
    prompt = SYNTHETIC_CONTINUE_PROMPT;
  }

  if (iter >= max) endedReason = 'max-iterations';

  log('info', 'conversation.completed', {
    iterations: iter,
    supTurns,
    devTurns,
    endedReason,
  });
  orch.emit('conversation-completed', {
    iterations: iter,
    totalTurns: { supervisor: supTurns, developer: devTurns },
    endedReason,
  });

  return {
    iterations: iter,
    totalTurns: { supervisor: supTurns, developer: devTurns },
    supervisorSessionId: supSession ?? null,
    developerSessionId: agentSessions.developer ?? null,
    agentSessions,
    endedReason,
    lastTurn,
  };
}
