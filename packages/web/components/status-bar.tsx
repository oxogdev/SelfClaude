'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { SessionMeta } from '@/lib/types';

export function StatusBar({ meta, busy }: { meta: SessionMeta | null; busy: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-bg-subtle px-4 py-2 text-sm">
      <Link href="/" className="text-zinc-400 hover:text-zinc-200" aria-label="back">
        <ChevronLeft size={16} />
      </Link>
      <span className="font-medium">{meta?.label ?? '…'}</span>
      <code className="text-xs text-zinc-500 truncate">{meta?.cwd}</code>
      <div className="ml-auto flex items-center gap-3 text-xs">
        <Indicator label="phase" value={meta?.phase ?? '…'} accent="cyan" />
        <Indicator label="sup" active={meta?.supActive ?? false} />
        <Indicator label="dev" active={meta?.devActive ?? false} />
        {busy && <span className="text-cyan-400">working…</span>}
      </div>
    </div>
  );
}

function Indicator({
  label,
  active,
  value,
  accent = 'green',
}: {
  label: string;
  active?: boolean;
  value?: string;
  accent?: 'green' | 'cyan';
}) {
  if (value !== undefined) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-zinc-500">{label}:</span>
        <span className={accent === 'cyan' ? 'text-cyan-400' : 'text-emerald-400'}>{value}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <span
        className={`inline-block size-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-700'}`}
      />
      <span className="text-zinc-500">{label}</span>
    </span>
  );
}
