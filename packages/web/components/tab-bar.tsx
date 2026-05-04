'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Folder, Home, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { SessionMeta } from '@/lib/types';
import { cn } from '@/lib/cn';

const POLL_MS = 4_000;

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeId = (() => {
    const m = pathname?.match(/^\/sessions\/([^/]+)/);
    return m?.[1] ?? null;
  })();

  const refresh = async () => {
    try {
      const r = await api.listSessions();
      setSessions(r.sessions);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const closeTab = async (id: string) => {
    try {
      await api.destroySession(id);
      const next = sessions.filter((s) => s.id !== id);
      setSessions(next);
      if (id === activeId) {
        const fallback = next[next.length - 1];
        router.push(fallback ? `/sessions/${fallback.id}` : '/');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex items-stretch bg-bg-subtle border-b border-border h-9 overflow-x-auto scrollbar-thin shrink-0">
      <Link
        href="/"
        className={cn(
          'px-3 flex items-center text-zinc-400 hover:text-zinc-200 border-r border-border',
          pathname === '/' && 'text-zinc-100 bg-bg-panel',
        )}
        aria-label="home"
      >
        <Home size={14} />
      </Link>

      {sessions.map((s) => (
        <Tab
          key={s.id}
          session={s}
          active={s.id === activeId}
          onClose={() => closeTab(s.id)}
        />
      ))}

      <Link
        href="/"
        className="px-3 flex items-center text-zinc-400 hover:text-zinc-200 border-r border-border"
        title="new project"
      >
        <Plus size={14} />
      </Link>

      {error && (
        <span className="ml-auto px-3 self-center text-xs text-red-400 truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function Tab({
  session,
  active,
  onClose,
}: {
  session: SessionMeta;
  active: boolean;
  onClose: () => void;
}) {
  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        'group flex items-center gap-2 px-3 text-sm border-r border-border min-w-0',
        active
          ? 'bg-bg-panel text-zinc-100 border-b-2 border-b-cyan-500 -mb-px'
          : 'text-zinc-400 hover:bg-bg-elevated',
      )}
      title={session.cwd}
    >
      <Folder size={12} className="shrink-0 text-zinc-500" />
      <span className="truncate max-w-[160px]">{session.label}</span>
      {session.busy && <span className="text-xs text-cyan-400 shrink-0">●</span>}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          'shrink-0 rounded p-0.5 transition-opacity',
          'opacity-0 group-hover:opacity-60 hover:!opacity-100',
          active && 'opacity-50',
        )}
        aria-label={`close ${session.label}`}
      >
        <X size={12} />
      </button>
    </Link>
  );
}
