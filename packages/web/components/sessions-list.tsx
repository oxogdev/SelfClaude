'use client';

import Link from 'next/link';
import { ChevronRight, Folder } from 'lucide-react';
import type { SessionMeta } from '@/lib/types';

export function SessionsList({ sessions }: { sessions: SessionMeta[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-subtle p-12 text-center">
        <p className="text-zinc-400 mb-2">No active projects.</p>
        <p className="text-sm text-zinc-500">
          Click <span className="text-zinc-300">Open Project</span> above to pick a folder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={`/sessions/${s.id}`}
          className="flex items-center justify-between rounded-lg border border-border bg-bg-panel p-4 hover:bg-bg-elevated"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Folder size={18} className="text-zinc-500 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium truncate">{s.label}</div>
              <code className="text-xs text-zinc-500 truncate block">{s.cwd}</code>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <span className="text-xs text-zinc-400">phase: {s.phase}</span>
            <ActivityDots sup={s.supActive} dev={s.devActive} busy={s.busy} />
            <ChevronRight size={16} className="text-zinc-600" />
          </div>
        </Link>
      ))}
    </div>
  );
}

function ActivityDots({ sup, dev, busy }: { sup: boolean; dev: boolean; busy: boolean }) {
  const Dot = ({ active, label }: { active: boolean; label: string }) => (
    <span className="flex items-center gap-1 text-xs">
      <span
        className={`inline-block size-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-700'}`}
      />
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
