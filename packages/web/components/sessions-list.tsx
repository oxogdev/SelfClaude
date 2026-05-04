'use client';

import Link from 'next/link';
import { ChevronRight, Folder, Pin, PinOff } from 'lucide-react';
import type { Favorite, SessionMeta } from '@/lib/types';

export function SessionsList({
  sessions,
  pinnedCwds,
  onTogglePin,
}: {
  sessions: SessionMeta[];
  pinnedCwds: Set<string>;
  onTogglePin: (cwd: string, label: string) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Active sessions</h2>
      <div className="space-y-2">
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            pinned={pinnedCwds.has(s.cwd)}
            onTogglePin={() => onTogglePin(s.cwd, s.label)}
          />
        ))}
      </div>
    </section>
  );
}

function SessionCard({
  session,
  pinned,
  onTogglePin,
}: {
  session: SessionMeta;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg-panel p-4 hover:bg-bg-elevated">
      <Link href={`/sessions/${session.id}`} className="flex items-center gap-3 min-w-0 flex-1">
        <Folder size={18} className="text-zinc-500 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium truncate">{session.label}</div>
          <code className="text-xs text-zinc-500 truncate block">{session.cwd}</code>
        </div>
      </Link>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <span className="text-xs text-zinc-400">phase: {session.phase}</span>
        <ActivityDots sup={session.supActive} dev={session.devActive} busy={session.busy} />
        <button
          onClick={(e) => {
            e.preventDefault();
            onTogglePin();
          }}
          className="p-1 rounded text-zinc-500 hover:text-amber-300 hover:bg-bg-elevated"
          aria-label={pinned ? 'unpin' : 'pin'}
          title={pinned ? 'Unpin from favorites' : 'Pin to favorites'}
        >
          {pinned ? <Pin size={14} className="text-amber-400 fill-amber-400" /> : <Pin size={14} />}
        </button>
        <Link href={`/sessions/${session.id}`}>
          <ChevronRight size={16} className="text-zinc-600" />
        </Link>
      </div>
    </div>
  );
}

export function PinnedList({
  favorites,
  activeCwds,
  onOpen,
  onUnpin,
}: {
  favorites: Favorite[];
  activeCwds: Set<string>;
  onOpen: (cwd: string, label: string) => void;
  onUnpin: (cwd: string) => void;
}) {
  if (favorites.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-wide text-amber-400 mb-2 flex items-center gap-1.5">
        <Pin size={12} className="fill-amber-400" />
        Pinned
      </h2>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {favorites.map((fav) => {
          const isActive = activeCwds.has(fav.cwd);
          return (
            <div
              key={fav.cwd}
              className="flex items-center justify-between rounded-md border border-border bg-bg-panel p-3 hover:bg-bg-elevated group"
            >
              <button
                onClick={() => onOpen(fav.cwd, fav.label)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
              >
                <Folder size={14} className="text-zinc-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{fav.label}</div>
                  <code className="text-xs text-zinc-500 truncate block">{fav.cwd}</code>
                </div>
                {isActive && (
                  <span className="text-xs text-emerald-400 shrink-0 ml-2">live</span>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onUnpin(fav.cwd);
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100"
                aria-label="unpin"
                title="Unpin"
              >
                <PinOff size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityDots({ sup, dev, busy }: { sup: boolean; dev: boolean; busy: boolean }) {
  const Dot = ({ active, label }: { active: boolean; label: string }) => (
    <span className="flex items-center gap-1 text-xs">
      <span className={`inline-block size-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
      <span className="text-zinc-500">{label}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-2">
      <Dot active={sup} label="sup" />
      <Dot active={dev} label="dev" />
      {busy && <span className="text-xs text-cyan-400">working</span>}
    </div>
  );
}
