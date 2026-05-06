'use client';

import { useSyncExternalStore } from 'react';

/* ─── Closing-id store, durable across page reloads ─────────────────
 *
 * When the operator clicks X to close a session tab, the destroy
 * round-trip (5s busy-wait + orchestrator stop + CC subprocess
 * SIGTERM) can outlast a single polling cycle. Without a tombstone,
 * the very next `listSessions` poll would re-introduce the session
 * into both `<TabBar>` and the home-page "Active sessions" card.
 *
 * The tombstone has to survive three different lifetimes:
 *
 *   1. The component instance — `<TabBar>` lives inside each page,
 *      so a router.push triggered by closing the active tab unmounts
 *      the originating instance.
 *   2. Cross-component reads — the home page's "Active sessions"
 *      card needs to filter by the same set TabBar populated.
 *   3. A full page reload — refreshing the browser drops module
 *      memory, but the backend destroy may still be in flight.
 *
 * (1) and (2) are solved by hoisting state to module scope.
 * (3) is solved by persisting entries to sessionStorage with an
 * expiry timestamp, then re-hydrating on module init. We use
 * sessionStorage (not local) because closing tombstones shouldn't
 * leak across browser sessions.
 *
 * Stored shape: `{ "<sessionId>": <expiresAtMs> }`. Entries past
 * their expiry are dropped at hydration and at every read.
 */

const STORAGE_KEY = 'selfclaude.closingSessions.v1';
const TTL_MS = 30_000;

const closingIds = new Map<string, number>(); // id → expiresAt (ms epoch)
const listeners = new Set<() => void>();
let tick = 0;

function readStorage(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, number> = {};
    for (const [k, v] of closingIds) obj[k] = v;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* private mode or quota — non-fatal */
  }
}

// Hydrate from sessionStorage on module load (first import). Drops
// entries whose TTL has already passed.
(function hydrate() {
  if (typeof window === 'undefined') return;
  const stored = readStorage();
  const now = Date.now();
  let dirty = false;
  for (const [id, expiresAt] of Object.entries(stored)) {
    if (typeof expiresAt === 'number' && expiresAt > now) {
      closingIds.set(id, expiresAt);
    } else {
      dirty = true;
    }
  }
  if (dirty) writeStorage();
})();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): number {
  return tick;
}

function bump(): void {
  tick += 1;
  for (const cb of listeners) cb();
}

/** Drop any entries whose TTL has elapsed. */
function pruneExpired(): boolean {
  const now = Date.now();
  let dirty = false;
  for (const [id, expiresAt] of closingIds) {
    if (expiresAt <= now) {
      closingIds.delete(id);
      dirty = true;
    }
  }
  if (dirty) writeStorage();
  return dirty;
}

export function isClosing(id: string): boolean {
  const expiresAt = closingIds.get(id);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    closingIds.delete(id);
    writeStorage();
    return false;
  }
  return true;
}

export function markClosing(id: string): void {
  closingIds.set(id, Date.now() + TTL_MS);
  writeStorage();
  bump();
}

export function clearClosing(id: string): void {
  if (closingIds.delete(id)) {
    writeStorage();
    bump();
  }
}

/**
 * Subscribe a component to closing-id changes. Returns a stable tick
 * value that React uses to detect updates — components don't need to
 * use the value directly, just call this hook so they re-render when
 * the set mutates and `isClosing` results change.
 */
export function useClosingTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Filter helper for any list of session-like objects with an `id`
 * field. Returns a new array without entries currently being closed.
 * Calls `pruneExpired` first so items whose TTL elapsed naturally
 * fall back into the visible set.
 */
export function filterClosing<T extends { id: string }>(items: T[]): T[] {
  if (pruneExpired()) bump();
  return items.filter((s) => !isClosing(s.id));
}
