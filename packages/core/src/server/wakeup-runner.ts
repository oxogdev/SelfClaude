import { randomUUID } from 'node:crypto';
import { log } from '../lib/log.js';

/**
 * Which agent a wakeup is aimed at. The supervisor and developer each carry
 * at most one pending wakeup; rescheduling for the same role replaces the
 * existing timer (newest call wins).
 */
export type WakeupRole = 'supervisor' | 'developer';

/**
 * A pending wakeup — registered by the agent itself via the `ScheduleWakeup`
 * tool, owned by the orchestrator. When its timer fires the runner injects
 * `prompt` as a synthetic user message into the agent so it can resume.
 */
export interface ScheduledWakeup {
  /** Internal id (UUID) — distinct from CC's tool_use_id. */
  id: string;
  /** Which agent will be re-prompted. */
  role: WakeupRole;
  /** When the wakeup was registered (ms since epoch). */
  scheduledAt: number;
  /** When the timer should fire (ms since epoch). */
  fireAt: number;
  /** Synthetic prompt to inject when the timer fires. */
  prompt: string;
  /** Free-form reason from the agent — surfaced in UI/telemetry only. */
  reason: string;
}

/**
 * A snapshot of a wakeup state-change. Emitted to the SessionManager so it
 * can persist a chat-log entry, broadcast over SSE, and update the UI.
 */
export type WakeupEvent =
  | { kind: 'scheduled'; wakeup: ScheduledWakeup }
  | { kind: 'fired'; wakeup: ScheduledWakeup }
  | { kind: 'cancelled'; wakeup: ScheduledWakeup; reason: 'replaced' | 'user-input' | 'shutdown' };

/**
 * Callback invoked when a wakeup actually fires. Implementation responsibility:
 *   - inject `wakeup.prompt` into the appropriate agent
 *   - drive its turn (await busy if necessary)
 *   - report any error back via the standard SessionEvent error path
 *
 * The runner does not itself touch the orchestrator; it only schedules and
 * cancels timers. Decoupling the trigger from the dispatch keeps the runner
 * unit-testable without an Orchestrator instance.
 */
export type WakeupFireFn = (wakeup: ScheduledWakeup) => Promise<void>;

/**
 * In-memory wakeup runner. Holds at most one `setTimeout` handle per
 * (sessionId, role) pair. Replacing or cancelling a wakeup clears the
 * existing timer first so callbacks never double-fire.
 *
 * Persistence: the runner itself is stateless across process restart. The
 * SessionManager is responsible for restoring pending wakeups from the
 * chat-log on session boot (by calling `schedule()` for each unfired entry).
 */
export class WakeupRunner {
  /** sessionId → role → in-flight timer + wakeup descriptor. */
  private readonly timers = new Map<
    string,
    Map<WakeupRole, { handle: NodeJS.Timeout; wakeup: ScheduledWakeup }>
  >();

  /** Listeners receive every state change; SessionManager attaches one. */
  private readonly listeners = new Set<(sessionId: string, event: WakeupEvent) => void>();

  /**
   * Register a callback for wakeup state changes. Returns an unsubscribe fn.
   */
  onEvent(listener: (sessionId: string, event: WakeupEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Schedule (or replace) a wakeup for `(sessionId, role)`. Cancels any
   * existing wakeup for the same role with reason 'replaced'. Returns the
   * created wakeup descriptor.
   *
   * `delaySeconds` is clamped to [1s, 24h] — defends against a malformed
   * tool input causing a near-instant or wildly-distant trigger.
   */
  schedule(
    sessionId: string,
    role: WakeupRole,
    input: { delaySeconds: number; prompt: string; reason: string },
    fire: WakeupFireFn,
  ): ScheduledWakeup {
    const delay = Math.max(1, Math.min(24 * 3600, Math.floor(input.delaySeconds)));
    const now = Date.now();
    const wakeup: ScheduledWakeup = {
      id: randomUUID(),
      role,
      scheduledAt: now,
      fireAt: now + delay * 1000,
      prompt: input.prompt,
      reason: input.reason,
    };

    this.cancel(sessionId, role, 'replaced');

    const handle = setTimeout(() => {
      // Pop ourselves out of the map before firing — guards against
      // re-entry if the fire callback synchronously schedules another.
      const bySession = this.timers.get(sessionId);
      bySession?.delete(role);
      if (bySession?.size === 0) this.timers.delete(sessionId);

      this.broadcast(sessionId, { kind: 'fired', wakeup });
      void fire(wakeup).catch((err) => {
        log('warn', 'wakeup.fire_failed', {
          sessionId,
          role,
          wakeupId: wakeup.id,
          error: (err as Error).message,
        });
      });
    }, delay * 1000);

    // Don't keep the Node event loop alive solely for a wakeup. The web
    // server itself holds the loop open; once it shuts down, pending
    // wakeups are discarded (their existence is recorded in chat-log so a
    // future boot can restore them).
    handle.unref?.();

    let bySession = this.timers.get(sessionId);
    if (!bySession) {
      bySession = new Map();
      this.timers.set(sessionId, bySession);
    }
    bySession.set(role, { handle, wakeup });

    this.broadcast(sessionId, { kind: 'scheduled', wakeup });
    return wakeup;
  }

  /**
   * Cancel a pending wakeup for `(sessionId, role)`. No-op if none exists.
   * `reason` distinguishes the cause for telemetry (replaced by a newer
   * schedule, superseded by user input, or session shutdown).
   */
  cancel(
    sessionId: string,
    role: WakeupRole,
    reason: 'replaced' | 'user-input' | 'shutdown',
  ): ScheduledWakeup | null {
    const bySession = this.timers.get(sessionId);
    const entry = bySession?.get(role);
    if (!entry) return null;
    clearTimeout(entry.handle);
    bySession?.delete(role);
    if (bySession && bySession.size === 0) this.timers.delete(sessionId);
    this.broadcast(sessionId, { kind: 'cancelled', wakeup: entry.wakeup, reason });
    return entry.wakeup;
  }

  /** Cancel every wakeup for a session. Used on session destroy. */
  cancelAll(sessionId: string, reason: 'shutdown' = 'shutdown'): void {
    const bySession = this.timers.get(sessionId);
    if (!bySession) return;
    for (const role of Array.from(bySession.keys())) {
      this.cancel(sessionId, role, reason);
    }
  }

  /**
   * List currently pending wakeups for a session. Useful for snapshots /
   * debugging; UI consumers should rely on the chat-log + SSE stream.
   */
  list(sessionId: string): ScheduledWakeup[] {
    const bySession = this.timers.get(sessionId);
    if (!bySession) return [];
    return Array.from(bySession.values()).map((v) => v.wakeup);
  }

  private broadcast(sessionId: string, event: WakeupEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(sessionId, event);
      } catch (e) {
        log('warn', 'wakeup.listener_throw', { error: (e as Error).message });
      }
    }
  }
}

/**
 * Validate the raw `input` of a `ScheduleWakeup` tool call. Returns null if
 * the shape is wrong (missing fields, non-positive delay, non-string prompt)
 * — the caller should ignore the call rather than fire on garbage.
 */
export function parseScheduleWakeupInput(
  raw: Record<string, unknown>,
): { delaySeconds: number; prompt: string; reason: string } | null {
  const delaySeconds = Number(raw.delaySeconds);
  if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) return null;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  const reason = typeof raw.reason === 'string' ? raw.reason : '';
  if (!prompt) return null;
  return { delaySeconds, prompt, reason };
}
