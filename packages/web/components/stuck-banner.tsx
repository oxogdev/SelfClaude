'use client';

import { useSessionStore } from '@/lib/store';
import { SessionBanner } from './session-banner';

/**
 * Phase 7 sprint 2B — stuck-detection banner.
 *
 * Reads the per-session `stuckStatus` slot. When the orchestrator's
 * detector flips a session to stuck, the slot updates to
 * `{stuck: true, reason, minutesSinceProgress}` and this banner pops
 * in below the StatusBar (above the turn-error banner) with an
 * amber tint and a concrete suggestion for what to do next.
 *
 * When the detector flips back (operator nudged sup, sup made
 * progress), `stuck` goes false and the banner unmounts. We don't
 * persist a "history" of stuck transitions — only the current state
 * matters for the operator-facing nudge.
 *
 * Per ROADMAP calibration #7: this is a *trust-signalling* feature.
 * It surfaces silent failures the operator would otherwise miss,
 * but never blocks the session itself.
 */
export function StuckBanner({ sessionId }: { sessionId: string }) {
  const stuckStatus = useSessionStore((s) => s.sessions[sessionId]?.stuckStatus ?? null);

  if (!stuckStatus || !stuckStatus.stuck) return null;

  const { reason, minutesSinceProgress } = stuckStatus;
  const ageLabel =
    minutesSinceProgress === null
      ? 'no progress recorded yet'
      : `${Math.round(minutesSinceProgress)} min since the last file change or decision`;

  // Reason-tuned copy. The catalogue stays small — every operator-
  // facing string is here, in one place, so a heuristic-tweak diff
  // surfaces clearly in review.
  const body =
    reason === 'no-progress-yet'
      ? `The supervisor has run several turns without delegating any writes or making a phase-tracker decision. Often this means sup is stuck in discussion — try sending it a more directive message, or prompt the developer/specialists directly via their tab.`
      : `${ageLabel}. The session is alive but isn't moving forward; either an agent is looping on something or sup is waiting for an instruction it didn't ask for. Send a follow-up prompt, click Stop on the active turn, or wait if you know it's working in the background.`;

  return (
    <SessionBanner
      open
      severity="warn"
      title="Session looks stuck"
      body={body}
    />
  );
}
