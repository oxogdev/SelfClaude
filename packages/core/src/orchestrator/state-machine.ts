/**
 * Orchestrator finite state machine.
 *
 * Invariant: at most one Claude Code subprocess is running at a time. Turns
 * are serialized; the FSM tracks who currently holds the floor and any
 * pending user-facing prompts (questions, approvals).
 *
 * This is the M2 skeleton — the surface is intentionally narrow. New
 * transitions are added as the hook bridge (M3), MCP server (M5), and
 * destructive-op gating (M6) come online.
 */

export type Phase = 'discovery' | 'docs' | 'phase-loop' | 'paused' | 'shutdown';

export type FsmTag =
  | 'idle'
  | 'sup-running'
  | 'dev-running'
  | 'awaiting-user'
  | 'awaiting-approval'
  | 'paused'
  | 'shutdown';

export type FsmState =
  | { tag: 'idle'; phase: Phase }
  | { tag: 'sup-running'; phase: Phase }
  | { tag: 'dev-running'; phase: Phase }
  | { tag: 'awaiting-user'; phase: Phase; questionId: string }
  | { tag: 'awaiting-approval'; phase: Phase; approvalId: string }
  | { tag: 'paused'; phase: Phase; previous: Exclude<FsmTag, 'paused' | 'shutdown'> }
  | { tag: 'shutdown' };

export type FsmEvent =
  | { kind: 'sup-turn-start' }
  | { kind: 'sup-turn-end' }
  | { kind: 'dev-turn-start' }
  | { kind: 'dev-turn-end' }
  | { kind: 'ask-user'; questionId: string }
  | { kind: 'user-replied'; questionId: string }
  | { kind: 'request-approval'; approvalId: string }
  | { kind: 'approval-decided'; approvalId: string }
  | { kind: 'set-phase'; phase: Phase }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'shutdown' };

export class IllegalTransitionError extends Error {
  constructor(state: FsmState, event: FsmEvent) {
    super(`illegal transition: state=${state.tag} event=${event.kind}`);
    this.name = 'IllegalTransitionError';
  }
}

export function initialState(): FsmState {
  return { tag: 'idle', phase: 'discovery' };
}

function withPhase(state: FsmState, phase: Phase): FsmState {
  switch (state.tag) {
    case 'idle':
      return { tag: 'idle', phase };
    case 'sup-running':
      return { tag: 'sup-running', phase };
    case 'dev-running':
      return { tag: 'dev-running', phase };
    case 'awaiting-user':
      return { tag: 'awaiting-user', phase, questionId: state.questionId };
    case 'awaiting-approval':
      return { tag: 'awaiting-approval', phase, approvalId: state.approvalId };
    case 'paused':
      return { tag: 'paused', phase, previous: state.previous };
    case 'shutdown':
      return state;
  }
}

export function transition(state: FsmState, event: FsmEvent): FsmState {
  if (event.kind === 'shutdown') return { tag: 'shutdown' };
  if (state.tag === 'shutdown') throw new IllegalTransitionError(state, event);

  if (event.kind === 'set-phase') return withPhase(state, event.phase);

  if (event.kind === 'pause') {
    if (state.tag === 'paused') return state;
    return { tag: 'paused', phase: state.phase, previous: state.tag };
  }

  switch (state.tag) {
    case 'idle': {
      if (event.kind === 'sup-turn-start') return { tag: 'sup-running', phase: state.phase };
      if (event.kind === 'dev-turn-start') return { tag: 'dev-running', phase: state.phase };
      throw new IllegalTransitionError(state, event);
    }
    case 'sup-running': {
      if (event.kind === 'sup-turn-end') return { tag: 'idle', phase: state.phase };
      if (event.kind === 'ask-user')
        return { tag: 'awaiting-user', phase: state.phase, questionId: event.questionId };
      if (event.kind === 'request-approval')
        return { tag: 'awaiting-approval', phase: state.phase, approvalId: event.approvalId };
      throw new IllegalTransitionError(state, event);
    }
    case 'dev-running': {
      if (event.kind === 'dev-turn-end') return { tag: 'idle', phase: state.phase };
      if (event.kind === 'request-approval')
        return { tag: 'awaiting-approval', phase: state.phase, approvalId: event.approvalId };
      throw new IllegalTransitionError(state, event);
    }
    case 'awaiting-user': {
      if (event.kind === 'user-replied' && event.questionId === state.questionId)
        return { tag: 'sup-running', phase: state.phase };
      throw new IllegalTransitionError(state, event);
    }
    case 'awaiting-approval': {
      if (event.kind === 'approval-decided' && event.approvalId === state.approvalId)
        return { tag: 'idle', phase: state.phase };
      throw new IllegalTransitionError(state, event);
    }
    case 'paused': {
      if (event.kind === 'resume') return { tag: 'idle', phase: state.phase };
      throw new IllegalTransitionError(state, event);
    }
  }
}
