'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, GitBranch, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { api, type IsolationStateView } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Phase 5 (Trust v1) — status-bar widget for git branch isolation.
 *
 * UX states:
 *
 *   - workspace not a git repo OR detached HEAD     → widget hidden
 *   - repo exists, isolation off                    → small [Enable] pill
 *   - isolation on, branch exists                   → branch + commit count
 *                                                     + [Accept] [Discard]
 *   - isolation persisted but branch gone (drift)   → warning + [Reset]
 *
 * Polls `/api/sessions/:id/git/isolation-state` every 5s.
 *
 * **Hook contract.** All hooks fire unconditionally at the top; the
 * function has a single `return` at the bottom whose JSX is computed
 * via plain `if/else` on locals. This shape rules out the
 * "Rendered fewer hooks than expected" trap that early returns can
 * trigger when the rendering tree shape varies across renders.
 */
export function IsolationWidget({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<IsolationStateView | null>(null);
  const [pending, setPending] = useState<
    'idle' | 'starting' | 'accepting' | 'discarding'
  >('idle');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getIsolationState(sessionId);
      setState(r);
    } catch {
      /* probe failure — leave previous state intact */
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const onEnable = useCallback(async () => {
    if (!state) return;
    if (pending !== 'idle') return;
    if (state.repoState.dirty) {
      setError(
        'commit or stash your pending changes first — isolation refuses to fork off a dirty tree',
      );
      return;
    }
    if (!state.repoState.currentBranch) {
      setError('check out a branch first (HEAD is detached)');
      return;
    }
    setError(null);
    setPending('starting');
    const branch = `selfclaude/${sessionId.slice(0, 8)}`;
    try {
      const r = await api.startIsolation(sessionId, branch);
      if (!r.ok) setError(r.message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending('idle');
    }
  }, [state, pending, sessionId, refresh]);

  const onAccept = useCallback(async () => {
    if (!state?.isolation) return;
    if (pending !== 'idle') return;
    const isolation = state.isolation;
    const ok = window.confirm(
      `Squash-merge ${isolation.branch} (${state.branchStatus?.commitCount ?? 0} commits) into ${isolation.originalBranch}?\n\n` +
        `This collapses the per-turn history into ONE commit on ${isolation.originalBranch}, ` +
        `then deletes ${isolation.branch}. The granular history disappears — be sure first.`,
    );
    if (!ok) return;
    setError(null);
    setPending('accepting');
    try {
      const r = await api.acceptIsolation(
        sessionId,
        isolation.branch,
        isolation.originalBranch,
        `[selfclaude] session ${sessionId.slice(0, 8)} — accepted`,
      );
      if (!r.ok) setError(r.message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending('idle');
    }
  }, [state, pending, sessionId, refresh]);

  const onDiscard = useCallback(async () => {
    if (!state?.isolation) return;
    if (pending !== 'idle') return;
    const isolation = state.isolation;
    const ok = window.confirm(
      `Discard ${isolation.branch} entirely?\n\n` +
        `Every commit on the branch + any uncommitted changes will be wiped. ` +
        `Worktree returns to ${isolation.originalBranch}'s HEAD. There is no undo.`,
    );
    if (!ok) return;
    setError(null);
    setPending('discarding');
    try {
      const r = await api.discardIsolation(
        sessionId,
        isolation.branch,
        isolation.originalBranch,
      );
      if (!r.ok) setError(r.message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending('idle');
    }
  }, [state, pending, sessionId, refresh]);

  /* ─────────────────────────────────────────────────────────────────
   * All hooks fired unconditionally above. Below: pure JSX selection.
   * Single return path; React's hook tracker can't see fewer hooks
   * across renders here regardless of which JSX branch is chosen.
   * ─────────────────────────────────────────────────────────────── */

  let content: React.ReactNode = null;

  if (state) {
    const repo = state.repoState;
    const isolation = state.isolation;
    const branchStatus = state.branchStatus;

    // Hidden states: not a repo OR detached HEAD without active isolation.
    const visible =
      repo.isRepo && (repo.currentBranch !== null || isolation?.enabled === true);

    if (visible) {
      if (isolation?.enabled) {
        if (state.branchExistsOnDisk === false) {
          // Drift: persisted state claims active but the branch is gone.
          content = (
            <div
              className="flex items-center gap-2 px-2 py-1 rounded text-xs font-medium text-amber-200 bg-amber-950/40 border border-amber-700/40"
              title={`Persisted isolation references ${isolation.branch} but the branch is gone. Reset to clean up state.`}
            >
              <RotateCcw size={12} />
              <span>isolation drift</span>
              <button
                type="button"
                onClick={onDiscard}
                disabled={pending !== 'idle'}
                className="px-1.5 py-px rounded text-[10px] bg-amber-900/60 hover:bg-amber-800 text-amber-100"
              >
                Reset
              </button>
            </div>
          );
        } else {
          // Active.
          const shortBranch = isolation.branch.replace(/^selfclaude\//, '');
          const commitCount = branchStatus?.commitCount ?? 0;
          content = (
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-cyan-100 bg-cyan-950/40 border border-cyan-800/40"
                title={
                  `Isolation active on ${isolation.branch} (forked from ${isolation.originalBranch}). ` +
                  `${commitCount} commit(s), ${branchStatus?.filesChanged ?? 0} file(s) changed.`
                }
              >
                <GitBranch size={12} />
                <span className="font-mono">{shortBranch}</span>
                <span className="text-cyan-400/80">·</span>
                <span className="tabular-nums">
                  {commitCount} commit{commitCount === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                onClick={onAccept}
                disabled={pending !== 'idle'}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                  'text-emerald-100 bg-emerald-700/40 hover:bg-emerald-600/60 border border-emerald-700/40',
                  pending !== 'idle' && 'opacity-60 cursor-wait',
                )}
                title={`Squash-merge ${isolation.branch} into ${isolation.originalBranch}`}
              >
                {pending === 'accepting' ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
                <span>Accept</span>
              </button>
              <button
                type="button"
                onClick={onDiscard}
                disabled={pending !== 'idle'}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
                  'text-rose-100 bg-rose-900/40 hover:bg-rose-800/60 border border-rose-800/40',
                  pending !== 'idle' && 'opacity-60 cursor-wait',
                )}
                title={`Discard ${isolation.branch} entirely (irreversible)`}
              >
                {pending === 'discarding' ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Trash2 size={11} />
                )}
                <span>Discard</span>
              </button>
              {error && (
                <span
                  className="text-[10px] text-rose-300 max-w-[180px] truncate"
                  title={error}
                >
                  {error}
                </span>
              )}
            </div>
          );
        }
      } else {
        // Off.
        content = (
          <button
            type="button"
            onClick={onEnable}
            disabled={pending !== 'idle' || repo.dirty}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
              'text-zinc-400 hover:text-cyan-200 hover:bg-bg-elevated border border-transparent hover:border-cyan-900/40',
              (pending !== 'idle' || repo.dirty) && 'opacity-60 cursor-not-allowed',
            )}
            title={
              repo.dirty
                ? 'commit or stash pending changes first — isolation refuses to fork off a dirty tree'
                : `fork a session branch off ${repo.currentBranch} so this run is reversible`
            }
          >
            {pending === 'starting' ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <GitBranch size={11} />
            )}
            <span>Isolate</span>
            {error && (
              <span className="text-[10px] text-rose-300 max-w-[140px] truncate" title={error}>
                {error}
              </span>
            )}
          </button>
        );
      }
    }
  }

  return <>{content}</>;
}
