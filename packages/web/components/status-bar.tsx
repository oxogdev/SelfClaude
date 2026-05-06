'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, Copy, Pin, PinOff } from 'lucide-react';
import { api } from '@/lib/api';
import type { SessionMeta } from '@/lib/types';
import { cn } from '@/lib/cn';

/**
 * Session header strip — back link, project label/cwd, and quick
 * actions. Phase + sup/dev liveness indicators were moved to the
 * BottomToolbar (single source of truth for runtime telemetry); the
 * freed space now hosts operator actions: copy cwd, toggle pin. Pin
 * lets the operator promote a returning project to the home-page
 * favorites list without having to navigate back home and find it.
 */
export function StatusBar({ meta }: { meta: SessionMeta | null; busy?: boolean }) {
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [copied, setCopied] = useState(false);

  // Resolve initial pinned state from the favorites list. Refetched on
  // mount and whenever the cwd changes (rare — operator switching tabs).
  useEffect(() => {
    if (!meta?.cwd) {
      setPinned(null);
      return;
    }
    let cancelled = false;
    api
      .listFavorites()
      .then((r) => {
        if (cancelled) return;
        setPinned(r.favorites.some((f) => f.cwd === meta.cwd));
      })
      .catch(() => {
        if (!cancelled) setPinned(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meta?.cwd]);

  const togglePin = async () => {
    if (!meta?.cwd || pinPending || pinned === null) return;
    setPinPending(true);
    try {
      if (pinned) {
        await api.removeFavorite(meta.cwd);
        setPinned(false);
      } else {
        await api.addFavorite(meta.cwd, meta.label);
        setPinned(true);
      }
    } catch (e) {
      console.warn('toggle pin failed:', (e as Error).message);
    } finally {
      setPinPending(false);
    }
  };

  const copyCwd = async () => {
    if (!meta?.cwd) return;
    try {
      await navigator.clipboard.writeText(meta.cwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* silent */
    }
  };

  return (
    <div className="flex items-center gap-3 border-b-2 border-border-strong bg-bg-subtle px-4 py-2 text-sm">
      <Link
        href="/"
        className="text-zinc-400 hover:text-zinc-200"
        aria-label="back to home"
        title="Back to home"
      >
        <ChevronLeft size={16} />
      </Link>
      <span className="font-medium truncate">{meta?.label ?? '…'}</span>
      <button
        type="button"
        onClick={copyCwd}
        className="group flex items-center gap-1.5 min-w-0 text-xs text-zinc-500 hover:text-zinc-200 px-1 py-0.5 rounded hover:bg-bg-elevated"
        title={copied ? 'copied!' : 'copy path'}
      >
        <code className="truncate">{meta?.cwd ?? ''}</code>
        {copied ? (
          <Check size={11} className="shrink-0 text-emerald-400" />
        ) : (
          <Copy size={11} className="shrink-0 opacity-0 group-hover:opacity-60" />
        )}
      </button>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={togglePin}
          disabled={!meta || pinned === null || pinPending}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
            pinned
              ? 'text-amber-300 hover:bg-amber-950/30'
              : 'text-zinc-400 hover:text-amber-300 hover:bg-bg-elevated',
            pinPending && 'opacity-50 cursor-wait',
          )}
          title={pinned ? 'Unpin from home' : 'Pin to home'}
          aria-pressed={pinned ?? false}
        >
          {pinned ? (
            <>
              <Pin size={13} className="fill-amber-400 text-amber-400" />
              <span className="hidden sm:inline">Pinned</span>
            </>
          ) : (
            <>
              <PinOff size={13} />
              <span className="hidden sm:inline">Pin</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
