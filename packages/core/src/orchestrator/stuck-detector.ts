/**
 * Phase 7 sprint 2B (Failure handling) — stuck-detection heuristic.
 *
 * Pure function on a small input shape so it's trivial to test
 * without mocking the orchestrator. The session-manager runs this on
 * a periodic timer and emits `session-stuck` SSE events on
 * transitions; the frontend banner renders based on the result.
 *
 * **What "stuck" means here:**
 *   - The session has burned a non-trivial number of supervisor turns
 *   - …without producing a *progress marker* (file change, phase
 *     mutation, verdict — anything that materially advances the work)
 *   - …for a configurable window (default 5 minutes)
 *   - …AND we're not in a phase where idle-looking activity is
 *     expected (discovery, docs) or paused on operator input
 *     (pending question / approval).
 *
 * Per ROADMAP calibration #7: this is **trust-signalling**, not a
 * gate. We never pause the session ourselves — we just nudge the
 * operator. False positives are slightly worse UX; false negatives
 * are silent failures. So the thresholds tilt mildly conservative
 * (we'd rather notify a few minutes late than panic on every quiet
 * stretch).
 */

export interface StuckCheckInput {
  /** ms since epoch — current time, passed in for testability. */
  nowMs: number;
  /** Session's most recent progress marker timestamp, null if none seen yet. */
  lastProgressTs: number | null;
  /** Total supervisor turns the session has executed so far. */
  supTurnCount: number;
  /** Orchestrator's current FSM phase tag. */
  fsmPhase: 'discovery' | 'docs' | 'phase-loop' | 'paused' | 'shutdown' | string;
  /** True when a pending operator question / approval is in flight. */
  hasPending: boolean;
  /** True when the orchestrator is mid-turn (sup or dev currently running). */
  busy: boolean;
}

export interface StuckCheckOptions {
  /** Minutes without a progress marker before the session is flagged. Default 5. */
  thresholdMinutes?: number;
  /** Minimum supervisor turns before stuck-detection arms. Default 3. */
  minSupTurns?: number;
}

export interface StuckCheckResult {
  /** True when the session is currently considered stuck. */
  stuck: boolean;
  /** Reason code for telemetry / debugging; one of the values below. */
  reason:
    | 'in-discovery-or-docs'
    | 'pending-operator-input'
    | 'too-few-turns'
    | 'recent-progress'
    | 'no-progress-yet'
    | 'no-progress-window-exceeded';
  /**
   * Minutes since the last progress marker. Null when we've never
   * seen a marker (fresh session). Useful for the banner copy.
   */
  minutesSinceProgress: number | null;
}

export function detectStuck(
  input: StuckCheckInput,
  opts: StuckCheckOptions = {},
): StuckCheckResult {
  const thresholdMinutes = opts.thresholdMinutes ?? 5;
  const minSupTurns = opts.minSupTurns ?? 3;

  // Discovery / docs phases are *meant* to be heavy on Q&A. We don't
  // expect file changes there; suppress detection entirely.
  if (input.fsmPhase === 'discovery' || input.fsmPhase === 'docs') {
    return { stuck: false, reason: 'in-discovery-or-docs', minutesSinceProgress: null };
  }

  // Operator input is pending — that's the operator's turn, not a stuck agent.
  if (input.hasPending) {
    return { stuck: false, reason: 'pending-operator-input', minutesSinceProgress: null };
  }

  // Brand-new sessions haven't earned the chance to be stuck yet.
  if (input.supTurnCount < minSupTurns) {
    return { stuck: false, reason: 'too-few-turns', minutesSinceProgress: null };
  }

  // Special case: lots of sup turns but never a single progress marker.
  // That's the classic "sup is talking but not delegating writes" failure
  // — exactly what we want to surface.
  if (input.lastProgressTs === null) {
    return {
      stuck: true,
      reason: 'no-progress-yet',
      minutesSinceProgress: null,
    };
  }

  const minutesSinceProgress = (input.nowMs - input.lastProgressTs) / 60_000;
  if (minutesSinceProgress < thresholdMinutes) {
    return { stuck: false, reason: 'recent-progress', minutesSinceProgress };
  }

  return {
    stuck: true,
    reason: 'no-progress-window-exceeded',
    minutesSinceProgress,
  };
}

/**
 * Predicate: does this chat-log entry represent forward motion?
 *
 * Used by session-manager to update `lastProgressTs` as events fire.
 * Kept narrow on purpose — Read tool calls and Bash status pings are
 * very common but don't move the work forward, so they don't reset
 * the stuck timer.
 */
export function isProgressMarker(entryType: string, toolName?: string): boolean {
  // Phase-tracker mutations are unambiguous progress.
  if (
    entryType === 'phase-item-confirmed' ||
    entryType === 'phase-item-rejected' ||
    entryType === 'phase-item-operator-verified' ||
    entryType === 'phase-doc-written' ||
    entryType === 'phase-registered' ||
    entryType === 'verdict' ||
    entryType === 'task-marker' /* sup delegated work — counts as motion */
  ) {
    return true;
  }
  // File-changing tool calls from any agent are progress.
  if (
    entryType === 'dev-tool-call' ||
    entryType === 'agent-tool-call' ||
    entryType === 'sup-tool-call'
  ) {
    if (
      toolName === 'Edit' ||
      toolName === 'Write' ||
      toolName === 'NotebookEdit'
    ) {
      return true;
    }
  }
  return false;
}
