'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { FolderPicker } from '@/components/folder-picker';
import { SessionsList } from '@/components/sessions-list';
import { api } from '@/lib/api';
import type { SessionMeta } from '@/lib/types';

export default function Home() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = async () => {
    try {
      const r = await api.listSessions();
      setSessions(r.sessions);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handlePick = async (path: string) => {
    setPicking(false);
    setError(null);
    try {
      const meta = await api.createSession(path);
      router.push(`/sessions/${meta.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-full p-8 max-w-5xl mx-auto">
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

      <SessionsList sessions={sessions} />

      {picking && <FolderPicker onSelect={handlePick} onCancel={() => setPicking(false)} />}
    </div>
  );
}
