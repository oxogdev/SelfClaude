/**
 * Phase 7 (Failure handling) sprint 1 — failure mode catalog.
 *
 * Every operator-visible failure in SelfClaude routes through this
 * catalog. The catalog is the single source of truth that turns a
 * caught Error into a structured triple of {code, severity,
 * message}. Telemetry records the code; the UI renders the message
 * + suggested action; tests assert against the codes so a future
 * change to the human copy doesn't silently break monitoring.
 *
 * Per ROADMAP calibration #7: failure rate is *publicly visible*.
 * Hiding it doesn't make it disappear; it just makes operators feel
 * betrayed when they hit one. So the catalog is small and stable —
 * we'd rather classify into "unknown" honestly than invent a new
 * code per session and drown the dashboard.
 *
 * **Stable contract**: codes are part of the storage schema. Changing
 * a code requires a metrics-store schema bump. Adding a code is
 * fine. Removing a code requires a migration. Don't rename freely.
 */

/**
 * The stable code that lands in `session-metrics.jsonl`. New entries
 * are additive; existing entries must not change identifier.
 */
export type FailureCode =
  | 'tool-error'
  | 'agent-timeout'
  | 'context-overflow'
  | 'hook-validation'
  | 'network-error'
  | 'mcp-crash'
  | 'agent-aborted'
  | 'unknown';

export type FailureSeverity = 'info' | 'warn' | 'error';

export interface FailureMode {
  code: FailureCode;
  /** Short human label (≤30 chars). Used in chips/badges. */
  label: string;
  /** One-paragraph operator-facing description. */
  description: string;
  /** What the operator can do about it — concrete, not generic. */
  suggestedAction: string;
  severity: FailureSeverity;
}

const CATALOG: Record<FailureCode, FailureMode> = {
  'tool-error': {
    code: 'tool-error',
    label: 'tool error',
    description:
      'A tool call (Edit / Write / Bash / Read / etc.) failed during an agent turn. ' +
      'The tool returned a non-success result; the agent saw the error in its context ' +
      'and may retry on its next turn.',
    suggestedAction:
      'Open the tool detail pane to see the underlying error. Common causes: missing ' +
      'file, permission denied, syntax issue in the input. The agent typically ' +
      'recovers on the next turn — intervene only if it loops.',
    severity: 'warn',
  },
  'agent-timeout': {
    code: 'agent-timeout',
    label: 'agent timeout',
    description:
      'The agent subprocess did not complete its turn within the orchestrator-allowed ' +
      'window. The turn was terminated; partial output may have landed.',
    suggestedAction:
      'Send the agent a follow-up message asking it to break the work into smaller ' +
      'turns. If the timeout repeats, restart the session — long-running CC sessions ' +
      'sometimes accumulate state that slows them down.',
    severity: 'error',
  },
  'context-overflow': {
    code: 'context-overflow',
    label: 'context overflow',
    description:
      'The agent hit the model context limit. CC dropped older history to fit the ' +
      'remaining work, but cumulative context is still tight.',
    suggestedAction:
      'Wrap up the current phase and start a new session against the same project. ' +
      'The chat-log + state.json will be replayed; the operating context resets cleanly.',
    severity: 'warn',
  },
  'hook-validation': {
    code: 'hook-validation',
    label: 'hook denied',
    description:
      'A SelfClaude pre-tool hook (destructive-action gate, file-lock, phase-contract) ' +
      'rejected the agent\'s tool call. The denial is intentional — the orchestrator ' +
      'caught a contract violation before it touched disk.',
    suggestedAction:
      'Read the rejection message carefully. The contract is doing its job; either ' +
      'approve the action via the operator dialog or guide the agent to a different ' +
      'approach.',
    severity: 'info',
  },
  'network-error': {
    code: 'network-error',
    label: 'network error',
    description:
      'A network call failed mid-turn (Anthropic API, MCP bridge, hook server). ' +
      'Usually transient; the orchestrator retries where it can.',
    suggestedAction:
      'Wait a beat and let the retry logic do its job. If it persists, check your ' +
      'internet connection and the Anthropic status page. Hard-failed turns are safe ' +
      'to re-run — chat-log + git branch capture all work to date.',
    severity: 'warn',
  },
  'mcp-crash': {
    code: 'mcp-crash',
    label: 'MCP bridge error',
    description:
      'The MCP bridge between the agent and the orchestrator returned a non-success. ' +
      'Common when the orchestrator endpoint validates its inputs (zod schema rejection).',
    suggestedAction:
      'Check the agent\'s most recent tool call — the rejection message is in the tool ' +
      'result. Often the agent recovers automatically on the next turn.',
    severity: 'warn',
  },
  'agent-aborted': {
    code: 'agent-aborted',
    label: 'aborted',
    description:
      'The agent turn was aborted, usually by the operator clicking the stop button or ' +
      'closing the session mid-flight. Any in-flight work is captured in chat-log up to ' +
      'the abort point.',
    suggestedAction:
      'No action needed if you intended this. The chat-log preserves what landed; the ' +
      'next turn picks up cleanly.',
    severity: 'info',
  },
  unknown: {
    code: 'unknown',
    label: 'unknown error',
    description:
      'A failure surfaced that doesn\'t map to any catalogued mode. The orchestrator ' +
      'log has the underlying message; consider filing this as a triage item so the ' +
      'catalog can grow.',
    suggestedAction:
      'Open the audit log for the timestamped error message. If the same error recurs, ' +
      'open an issue with the message + steps so we can extend the catalog.',
    severity: 'error',
  },
};

export function getFailureMode(code: FailureCode): FailureMode {
  return CATALOG[code];
}

export function listFailureModes(): FailureMode[] {
  return Object.values(CATALOG);
}

/**
 * Heuristic classifier — turn a free-form error message into a stable
 * `FailureCode`. Used by the session-manager when wrapping caught
 * exceptions whose origin isn't already structured. Order matters: we
 * check the most distinctive markers first and fall through to
 * `unknown` so we never mis-classify by being too greedy.
 *
 * Adding a heuristic is fine; tightening one to be MORE specific is
 * also fine. Loosening a heuristic to swallow more cases requires
 * thinking about whether the new cases truly belong in that bucket.
 */
export function classifyFailure(rawMessage: string): FailureCode {
  const m = rawMessage.toLowerCase();
  if (m.includes('aborted') || m.includes('abort')) return 'agent-aborted';
  if (m.includes('timeout') || m.includes('timed out')) return 'agent-timeout';
  if (m.includes('context') && (m.includes('overflow') || m.includes('limit'))) {
    return 'context-overflow';
  }
  if (m.includes('hook') && (m.includes('denied') || m.includes('rejected') || m.includes('blocked'))) {
    return 'hook-validation';
  }
  if (
    m.includes('econn') ||
    m.includes('enotfound') ||
    m.includes('etimedout') ||
    m.includes('socket hang up') ||
    m.includes('fetch failed') ||
    m.includes('network')
  ) {
    return 'network-error';
  }
  if (m.includes('orchestrator returned') || m.includes('mcp')) return 'mcp-crash';
  if (m.includes('tool')) return 'tool-error';
  return 'unknown';
}
