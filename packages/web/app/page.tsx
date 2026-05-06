'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { TabBar } from '@/components/tab-bar';
import { FolderPicker } from '@/components/folder-picker';
import {
  NewProjectWizard,
  buildBootstrapBrief,
  type WizardSubmission,
} from '@/components/new-project-wizard';
import { SelfClaudeLogo } from '@/components/selfclaude-logo';
import { PinnedList, SessionsList } from '@/components/sessions-list';
import { api } from '@/lib/api';
import { filterClosing, useClosingTick } from '@/lib/closing-sessions';
import type { Favorite, SessionMeta } from '@/lib/types';

export default function Home() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [picking, setPicking] = useState(false);
  // Wizard runs after a folder pick — operator either fills the brief
  // (sup gets structured kickoff) or skips (sup runs cold Discovery).
  // `null` = no wizard active. The pickedCwd is persisted while the
  // wizard renders so we can `createSession` on launch/skip.
  const [wizardCwd, setWizardCwd] = useState<string | null>(null);
  // Distinct loading states: `loading` is the initial fetch (skeleton),
  // `error` covers any subsequent refresh failure (banner). After the
  // first fetch resolves, the layout settles and only banners surface.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [health, setHealth] = useState<{
    version: string;
    uptime: number;
    sessions: number;
  } | null>(null);

  // Subscribe to the shared closing-id store so a click in TabBar
  // reflects here too — the "Active sessions" card on this page would
  // otherwise keep showing a session that's mid-destroy until the next
  // refresh cycle clears it.
  const closingTick = useClosingTick();
  // Visible list filters out anything currently being torn down. The
  // raw list (from listSessions) might still include them while the
  // server-side destroy is in flight.
  const visibleSessions = useMemo(
    () => filterClosing(sessions),
    // closingTick is the dep that signals "the set changed, re-filter."
    // sessions itself triggers a recompute too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, closingTick],
  );

  const refresh = useCallback(async () => {
    try {
      const [s, f, h] = await Promise.all([
        api.listSessions(),
        api.listFavorites(),
        api.health().catch(() => null),
      ]);
      setSessions(s.sessions);
      setFavorites(f.favorites);
      if (h) setHealth(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Lightweight 4s polling to keep "Active sessions" fresh when the
  // operator returns to the home tab — without it, closing a session
  // elsewhere (or starting one in another tab) wouldn't reflect here
  // until a manual reload.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4_000);
    return () => clearInterval(t);
  }, [refresh]);

  const openCwd = async (path: string, label?: string) => {
    setPicking(false);
    setError(null);
    // Already-loaded session — jump to it. Use visibleSessions so we
    // don't try to "reuse" one that's mid-destroy.
    const existing = visibleSessions.find((s) => s.cwd === path);
    if (existing) {
      router.push(`/sessions/${existing.id}`);
      return;
    }
    // Probe disk: does this cwd already have a `.selfclaude/state.json`?
    // If yes, it's a returning project — skip the wizard, go straight
    // to a session create + navigate. Only truly-fresh cwds (no
    // state.json) get the wizard.
    try {
      const probe = await api.probeProject(path);
      if (probe.exists) {
        const meta = await api.createSession(path, label);
        router.push(`/sessions/${meta.id}`);
        return;
      }
    } catch (e) {
      // Probe failure shouldn't block — fall through to wizard which
      // can still handle the launch path. Surface as a soft error.
      console.warn('probeProject failed:', (e as Error).message);
    }
    setWizardCwd(path);
    void label; // label fields aren't part of v1 wizard wiring
  };

  const handleWizardLaunch = async (submission: WizardSubmission) => {
    if (!wizardCwd) return;
    const meta = await api.createSession(wizardCwd, submission.projectName);
    // Send the structured bootstrap brief as the operator's first
    // message; sup's prompt knows to parse it (see supervisor.md).
    await api.sendMessage(meta.id, buildBootstrapBrief(submission));
    setWizardCwd(null);
    router.push(`/sessions/${meta.id}`);
  };

  const handleWizardSkip = async () => {
    if (!wizardCwd) return;
    const meta = await api.createSession(wizardCwd);
    setWizardCwd(null);
    router.push(`/sessions/${meta.id}`);
  };

  const togglePin = async (cwd: string, label: string) => {
    const isPinned = favorites.some((f) => f.cwd === cwd);
    try {
      if (isPinned) {
        await api.removeFavorite(cwd);
      } else {
        await api.addFavorite(cwd, label);
      }
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unpin = async (cwd: string) => {
    try {
      await api.removeFavorite(cwd);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pinnedCwds = new Set(favorites.map((f) => f.cwd));
  const activeCwds = new Set(visibleSessions.map((s) => s.cwd));

  const isEmpty = visibleSessions.length === 0 && favorites.length === 0;

  return (
    <>
      <TabBar />
      <main className="p-8 max-w-5xl mx-auto relative">
        {/* Subtle hero glow — sits behind the logo, fades to nothing
            below the fold. Pure decoration, pointer-events-none so it
            doesn't intercept clicks. */}
        <div
          aria-hidden
          className="absolute -top-20 -left-10 w-[480px] h-[320px] pointer-events-none"
          style={{
            background:
              'radial-gradient(closest-side, rgba(6, 182, 212, 0.10), rgba(6, 182, 212, 0.04) 50%, transparent 80%)',
          }}
        />
        <header className="relative mb-10 flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <SelfClaudeLogo
              variant="wordmark"
              size="xl"
              caption="multi-agent orchestration"
            />
            <p className="mt-3 text-sm text-zinc-500 max-w-md leading-relaxed">
              A supervisor + specialist agents working in parallel — you stay
              in the loop, gating phases and verifying work.
            </p>
            {health && (
              <div className="mt-4 flex items-center gap-3 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  api online
                </span>
                <span className="text-zinc-700">·</span>
                <span>v{health.version}</span>
                <span className="text-zinc-700">·</span>
                <span>{formatUptime(health.uptime)}</span>
                <span className="text-zinc-700">·</span>
                <span>
                  {health.sessions} session{health.sessions === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
          {!loading && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-md bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm font-medium flex items-center gap-2 shrink-0 shadow-lg shadow-cyan-900/30"
            >
              <FolderOpen size={15} />
              Open Project
            </button>
          )}
        </header>

        <div className="relative">
          {error && (
            <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 p-3 text-sm text-red-300 flex items-center gap-2">
              <span className="shrink-0">⚠</span>
              <span className="flex-1 truncate" title={error}>{error}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="text-xs underline text-red-200 hover:text-white shrink-0"
              >
                retry
              </button>
            </div>
          )}

          {loading ? (
            <LandingSkeleton />
          ) : (
            <>
              <PinnedList
                favorites={favorites}
                activeCwds={activeCwds}
                onOpen={openCwd}
                onUnpin={unpin}
              />
              <SessionsList
                sessions={visibleSessions}
                pinnedCwds={pinnedCwds}
                onTogglePin={togglePin}
              />
              {isEmpty && (
                <EmptyState onPick={() => setPicking(true)} />
              )}
            </>
          )}
        </div>

        {picking && (
          <FolderPicker onSelect={(p) => openCwd(p)} onCancel={() => setPicking(false)} />
        )}
        {wizardCwd && (
          <NewProjectWizard
            cwd={wizardCwd}
            onLaunch={handleWizardLaunch}
            onSkip={handleWizardSkip}
            onCancel={() => setWizardCwd(null)}
          />
        )}
      </main>
    </>
  );
}

/**
 * Skeleton placeholders sized to roughly match the post-load layout
 * (1 pinned grid row + 2 active-session rows). Keeps the page from
 * jumping when data arrives, and signals "loading, not blank" without
 * a centred spinner that hides the upcoming layout.
 */
function LandingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-3 w-20 bg-zinc-800 rounded mb-2" />
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 rounded-md border border-border bg-bg-panel/40"
            />
          ))}
        </div>
      </div>
      <div>
        <div className="h-3 w-24 bg-zinc-800 rounded mb-2" />
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg border border-border bg-bg-panel/40"
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-600 pt-2">
        <Loader2 size={12} className="animate-spin" />
        <span>loading sessions…</span>
      </div>
    </div>
  );
}

/**
 * First-run landing block — replaces the previous flat "no projects yet"
 * panel with a more inviting CTA. Still single-button so the operator's
 * next click is unambiguous.
 */
function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-gradient-to-b from-bg-subtle/40 to-transparent p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-cyan-950/50 border border-cyan-800/40 mb-4">
        <Sparkles size={20} className="text-cyan-400" />
      </div>
      <h2 className="text-lg font-medium text-zinc-200 mb-2">
        Start your first project
      </h2>
      <p className="text-sm text-zinc-500 mb-6 max-w-md mx-auto leading-relaxed">
        Pick a folder, fill the wizard, and SelfClaude's supervisor agent
        will scaffold the project and start coordinating with the right
        specialists.
      </p>
      <button
        type="button"
        onClick={onPick}
        className="inline-flex items-center gap-2 rounded-md bg-cyan-600 hover:bg-cyan-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-cyan-900/30"
      >
        <FolderOpen size={15} />
        Open project folder
      </button>
    </div>
  );
}

/**
 * Format the daemon's uptime (seconds, from `/api/health`) as a
 * human-friendly string. Used in the landing status strip.
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
