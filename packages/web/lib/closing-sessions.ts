'use client';

import { useSyncExternalStore } from 'react';

/* ─── Module-level closing-id store ─────────────────────────────────
 *
 * When the operator clicks X to close a session tab, the destroy
 * round-trip (5s busy-wait + orchestrator stop + CC subprocess
 * SIGTERM) can outlast a single polling cycle. Without this shared
 * tombstone, the very next `listSessions` poll would re-introduce the
 * session into both `<TabBar>` and the home-page "Active sessions"
 * card before the server has finished tearing it down.
 *
 * Hoisting the set to module scope sidesteps a second issue too:
 * `<TabBar>` is mounted inside each page (not in the root layout), so
 * a router.push triggered by closing the active tab unmounts the
 * originating instance and mounts a fresh one with empty local state.
 * Module-level state survives that transition.
 *
 * `useSyncExternalStore` lets components subscribe — the bump counter
 * ticks whenever the set changes, triggering a re-render that re-runs
 * any `closingIds`-aware filter.
 */

const closingIds = new Set<string>();
const listeners = new Set<() => void>();
let tick = 0;

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

export function isClosing(id: string): boolean {
  return closingIds.has(id);
}

export function markClosing(id: string): void {
  if (closingIds.has(id)) return;
  closingIds.add(id);
  bump();
}

export function clearClosing(id: string): void {
  if (closingIds.delete(id)) bump();
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
 */
export function filterClosing<T extends { id: string }>(items: T[]): T[] {
  return items.filter((s) => !closingIds.has(s.id));
}
