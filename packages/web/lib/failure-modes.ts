/**
 * Phase 7 sprint 2 — web-side mirror of the failure-mode catalog.
 *
 * The authoritative source lives in
 * `packages/core/src/orchestrator/failure-modes.ts`. We duplicate the
 * user-facing strings here (instead of fetching via REST) because:
 *   - The catalog is small (8 entries) and stable.
 *   - Bundling avoids a network round-trip on session page load.
 *   - Codes are part of the storage contract; renaming on either
 *     side requires a coordinated change.
 *
 * If a code arrives that isn't in this map, callers fall back to
 * UNKNOWN_MODE so the UI still renders something sensible — better
 * to show a generic "unknown" entry than to crash on an unfamiliar
 * code (e.g. older session with a removed catalog entry).
 *
 * **Sync rule:** when `failure-modes.ts` in core changes, mirror it
 * here. The fields below are exactly what the catalog entry exposes
 * minus the `code` field (used as the map key).
 */

export type FailureSeverity = 'info' | 'warn' | 'error';

export interface FailureModeUI {
  /** Short human label (≤30 chars). Used in chips/badges. */
  label: string;
  /** One-paragraph operator-facing description. */
  description: string;
  /** What the operator can do about it — concrete, not generic. */
  suggestedAction: string;
  severity: FailureSeverity;
}

const CATALOG: Record<string, FailureModeUI> = {
  'tool-error': {
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
    label: 'hook denied',
    description:
      'A SelfClaude pre-tool hook (destructive-action gate, file-lock, phase-contract) ' +
      "rejected the agent's tool call. The denial is intentional — the orchestrator " +
      'caught a contract violation before it touched disk.',
    suggestedAction:
      'Read the rejection message carefully. The contract is doing its job; either ' +
      'approve the action via the operator dialog or guide the agent to a different ' +
      'approach.',
    severity: 'info',
  },
  'network-error': {
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
    label: 'MCP bridge error',
    description:
      'The MCP bridge between the agent and the orchestrator returned a non-success. ' +
      'Common when the orchestrator endpoint validates its inputs (zod schema rejection).',
    suggestedAction:
      "Check the agent's most recent tool call — the rejection message is in the tool " +
      'result. Often the agent recovers automatically on the next turn.',
    severity: 'warn',
  },
  'agent-aborted': {
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
    label: 'unknown error',
    description:
      "A failure surfaced that doesn't map to any catalogued mode. The orchestrator " +
      'log has the underlying message; consider filing this as a triage item so the ' +
      'catalog can grow.',
    suggestedAction:
      'Open the audit log for the timestamped error message. If the same error recurs, ' +
      'open an issue with the message + steps so we can extend the catalog.',
    severity: 'error',
  },
};

const UNKNOWN_MODE: FailureModeUI = CATALOG.unknown!;

/**
 * Resolve the catalog entry for a given code. Falls back to the
 * `unknown` entry when the code isn't recognised — keeps the UI from
 * crashing on a stale chat-log entry whose catalog entry was removed.
 */
export function getFailureModeUI(code: string): FailureModeUI {
  return CATALOG[code] ?? UNKNOWN_MODE;
}
