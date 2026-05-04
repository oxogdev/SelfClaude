'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { TabBar } from '@/components/tab-bar';
import { FolderPicker } from '@/components/folder-picker';
import { PinnedList, SessionsList } from '@/components/sessions-list';
import { api } from '@/lib/api';
import type { Favorite, SessionMeta } from '@/lib/types';

export default function Home() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([api.listSessions(), api.listFavorites()]);
      setSessions(s.sessions);
      setFavorites(f.favorites);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCwd = async (path: string, label?: string) => {
    setPicking(false);
    setError(null);
    try {
      // If a session for this cwd is already open, jump to it.
      const existing = sessions.find((s) => s.cwd === path);
      if (existing) {
        router.push(`/sessions/${existing.id}`);
        return;
      }
      const meta = await api.createSession(path, label);
      router.push(`/sessions/${meta.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
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
  const activeCwds = new Set(sessions.map((s) => s.cwd));

  return (
    <>
      <TabBar />
      <main className="p-8 max-w-5xl mx-auto">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">SelfClaude</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Two-Claude orchestration: supervisor + developer with you in the loop
            </p>
          </div>
          <button
            onClick={() => setPicking(true)}
            className="rounded-md bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm font-medium flex items-center gap-2"
          >
            <Plus size={16} />
            Open Project
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <PinnedList
          favorites={favorites}
          activeCwds={activeCwds}
          onOpen={openCwd}
          onUnpin={unpin}
        />

        <SessionsList sessions={sessions} pinnedCwds={pinnedCwds} onTogglePin={togglePin} />

        {sessions.length === 0 && favorites.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-bg-subtle p-12 text-center">
            <p className="text-zinc-400 mb-2">No projects yet.</p>
            <p className="text-sm text-zinc-500">
              Click <span className="text-zinc-300">Open Project</span> above to pick a folder.
            </p>
          </div>
        )}

        {picking && (
          <FolderPicker onSelect={(p) => openCwd(p)} onCancel={() => setPicking(false)} />
        )}
      </main>
    </>
  );
}
