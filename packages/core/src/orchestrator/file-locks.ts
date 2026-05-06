import { log } from '../lib/log.js';
import { realpathSync } from 'node:fs';

/**
 * In-memory file-lock manager. Tracks which agent is currently editing
 * which absolute file path. The orchestrator's PreToolUse hook consults
 * it before letting an `Edit` / `Write` tool call go through; locks
 * release at the end of the holding agent's turn (Stop hook) or when
 * the orchestrator times them out as stale (90s default).
 *
 * Today's serial-execution model means contention is rare — only
 * possible when an agent does `Edit` then `Bash` (which spawns a shell
 * that might write the same path). Once parallel agent dispatch lands
 * (sup emitting two `<TASK_FOR_DEVELOPER agent="…">` blocks the
 * orchestrator runs concurrently), this is the load-bearing piece that
 * keeps two CC subprocesses from racing on the same file.
 *
 * Design notes:
 *
 * - Keyed on `realpath` so symlinks and `./foo` vs `foo` collapse.
 * - Read-only tools (`Read`, `Grep`, `Glob`, `Bash` for `cat` / `ls`)
 *   never acquire — only mutating tools (`Write`, `Edit`).
 * - Stale-lock sweep: any lock older than `STALE_MS` is auto-released,
 *   defending against a crashed CC subprocess holding the lock forever.
 *   Conservative default — sup is expected to abort or retry via the
 *   emergency-stop button if a real hang persists.
 */

const STALE_MS = 90_000;

interface LockEntry {
  agent: string;
  path: string;
  acquiredAt: number;
}

export class FileLockManager {
  private readonly locks = new Map<string, LockEntry>();

  /**
   * Try to acquire a write lock for `agent` on `path`. Returns the
   * holder if the path is already locked by a *different* agent (the
   * caller — typically the PreToolUse hook — uses that to deny the
   * tool call with a useful reason).
   *
   * Re-acquiring a lock you already own is a no-op success — keeps the
   * hook simple when an agent does `Edit foo`, then `Edit foo` again
   * within the same turn.
   */
  tryAcquire(agent: string, path: string): { ok: true } | { ok: false; heldBy: string } {
    this.sweepStale();
    const key = canonicalize(path);
    const existing = this.locks.get(key);
    if (existing && existing.agent !== agent) {
      return { ok: false, heldBy: existing.agent };
    }
    if (!existing) {
      this.locks.set(key, { agent, path: key, acquiredAt: Date.now() });
    }
    return { ok: true };
  }

  /**
   * Release a single lock. Idempotent — releasing an unheld lock is a
   * no-op. Refuses to release a lock owned by another agent (defends
   * against a stale hook firing for an old turn).
   */
  release(agent: string, path: string): void {
    const key = canonicalize(path);
    const existing = this.locks.get(key);
    if (!existing) return;
    if (existing.agent !== agent) return;
    this.locks.delete(key);
  }

  /**
   * Drop every lock held by `agent`. Called from the Stop hook when
   * the agent's turn ends — guarantees no zombie locks even when an
   * individual `release` slipped past us.
   */
  releaseAll(agent: string): number {
    let count = 0;
    for (const [key, entry] of this.locks) {
      if (entry.agent === agent) {
        this.locks.delete(key);
        count += 1;
      }
    }
    if (count > 0) {
      log('info', 'file-locks.released_all', { agent, count });
    }
    return count;
  }

  /** Snapshot of currently-held locks. Useful for UI / debug surfacing. */
  list(): LockEntry[] {
    this.sweepStale();
    return Array.from(this.locks.values());
  }

  /** Forget anything older than `STALE_MS`. Defensive cleanup. */
  private sweepStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (now - entry.acquiredAt > STALE_MS) {
        log('warn', 'file-locks.stale_swept', {
          agent: entry.agent,
          path: entry.path,
          ageMs: now - entry.acquiredAt,
        });
        this.locks.delete(key);
      }
    }
  }
}

/**
 * Normalise a path for lock comparison — `realpath` collapses symlinks
 * and `./foo` / `foo` differences. Falls back to the raw path when the
 * file doesn't exist yet (typical for `Write` of a new file).
 */
function canonicalize(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
