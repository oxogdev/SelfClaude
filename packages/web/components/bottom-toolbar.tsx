'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  Folder,
  GitBranch,
  Layers,
  ListChecks,
  Pause,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ChatLogEntry, RoleMetrics, SessionMeta } from '@/lib/types';

/**
 * IDE-style status footer. Shows at-a-glance run-state metrics so the
 * operator never has to ask "what is the agent doing right now and how
 * much have we burned." Each badge is colour-coded by category:
 *
 *   ▸ phase         (cyan)    — discovery / docs / phase-loop
 *   ▸ activity      (amber)   — sup running / dev running / idle / paused
 *   ▸ session age   (zinc)    — wall clock since session opened
 *   ▸ last turn     (zinc)    — duration of the most recent role result
 *   ▸ total cost    (emerald) — sum of sup + dev costs
 *   ▸ turns         (zinc)    — sup + dev cumulative turn count
 *   ▸ tasks         (yellow)  — open todos
 *   ▸ files         (purple)  — distinct files touched
 *   ▸ project label (zinc)    — basename(cwd) so multi-tab is unambiguous
 *
 * Goal: the operator can absorb run-state in one second. We deliberately
 * avoid letting badges grow / shrink — fixed layout, fixed columns.
 */
export function BottomToolbar({
  meta,
  metrics,
  chatLog,
  busy,
}: {
  meta: SessionMeta | null;
  metrics: {
    sup: RoleMetrics;
    dev: RoleMetrics;
    agents: Record<string, RoleMetrics>;
  };
  chatLog: ChatLogEntry[];
  busy: boolean;
}) {
  // Wall clock since session creation, ticks every 5s for low CPU.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  if (!meta) {
    return (
      <div className="h-7 border-t-2 border-border-strong bg-bg-subtle flex items-center px-3 text-[10px] text-zinc-500">
        loading…
      </div>
    );
  }

  const ageMs = now - meta.createdAt;
  // Cost / turn / lastMs aggregate across every active role (sup + dev +
  // every specialist). With per-agent buckets we can also surface a
  // breakdown badge so the operator sees who's burning what.
  const agentEntries = Object.entries(metrics.agents);
  const totalCost =
    metrics.sup.totalCostUsd +
    metrics.dev.totalCostUsd +
    agentEntries.reduce((acc, [, m]) => acc + m.totalCostUsd, 0);
  const totalTurns =
    metrics.sup.totalTurns +
    metrics.dev.totalTurns +
    agentEntries.reduce((acc, [, m]) => acc + m.totalTurns, 0);
  const lastTurnMs = Math.max(
    metrics.sup.lastTurnMs,
    metrics.dev.lastTurnMs,
    ...agentEntries.map(([, m]) => m.lastTurnMs),
    0,
  );

  const todos = countOpenTodos(chatLog);
  const fileCount = countDistinctFiles(chatLog);

  const activity = computeActivity(meta, busy);

  return (
    <div className="h-7 border-t-2 border-border-strong bg-bg-subtle flex items-center gap-0 text-[10px] font-mono">
      <Badge
        icon={<Folder size={10} />}
        label={basename(meta.cwd)}
        color="text-zinc-300"
        title={meta.cwd}
      />
      <Sep />
      <Badge
        icon={<Layers size={10} />}
        label={meta.phase}
        color="text-cyan-300"
        bg="bg-cyan-950/40"
      />
      <Sep />
      <Badge
        icon={activity.icon}
        label={activity.label}
        color={activity.color}
        bg={activity.bg}
        pulse={activity.pulse}
      />
      <Sep />
      <Badge
        icon={<Clock size={10} />}
        label={formatDuration(ageMs)}
        color="text-zinc-400"
        title="wall clock since session opened"
      />
      <Sep />
      <Badge
        icon={<Zap size={10} />}
        label={lastTurnMs > 0 ? `${(lastTurnMs / 1000).toFixed(1)}s` : '—'}
        color="text-zinc-400"
        title="duration of the last completed role turn"
      />
      <Sep />
      <Badge
        icon={<DollarSign size={10} />}
        label={`$${totalCost.toFixed(4)}`}
        color="text-emerald-300"
        bg="bg-emerald-950/30"
        title="cumulative cost (sup + dev) in USD"
      />
      <Sep />
      <Badge
        icon={<GitBranch size={10} />}
        label={`${totalTurns} turns`}
        color="text-zinc-400"
        title="cumulative supervisor + developer turns"
      />
      <Sep />
      <Badge
        icon={<ListChecks size={10} />}
        label={todos > 0 ? `${todos} todo` : '—'}
        color={todos > 0 ? 'text-yellow-300' : 'text-zinc-500'}
      />
      <Sep />
      <Badge
        icon={<FileText size={10} />}
        label={fileCount > 0 ? `${fileCount} files` : '—'}
        color={fileCount > 0 ? 'text-purple-300' : 'text-zinc-500'}
      />
      <div className="flex-1" />
      <MetricsBreakdown metrics={metrics} agentEntries={agentEntries} />
    </div>
  );
}

/**
 * Click-to-expand drop-up showing per-role metrics breakdown. Default
 * collapsed: a single compact badge (`▴ breakdown`). Click → popover
 * above the toolbar listing every active role's cost / turns / last
 * duration. Closes on outside-click or Esc.
 *
 * Replaces the previous always-visible right-side badge stack which
 * pushed the toolbar past comfortable density when 3+ specialists were
 * active.
 */
function MetricsBreakdown({
  metrics,
  agentEntries,
}: {
  metrics: { sup: RoleMetrics; dev: RoleMetrics; agents: Record<string, RoleMetrics> };
  agentEntries: [string, RoleMetrics][];
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const rows: { label: string; metrics: RoleMetrics; accent: string }[] = [
    { label: 'supervisor', metrics: metrics.sup, accent: 'text-cyan-400' },
    { label: 'developer', metrics: metrics.dev, accent: 'text-amber-400' },
    ...agentEntries.map(([agent, m]) => ({
      label: agent,
      metrics: m,
      accent: agentCostAccent(agent),
    })),
  ];
  const activeRows = rows.filter((r) => r.metrics.totalTurns > 0 || r.metrics.totalCostUsd > 0);

  return (
    <div ref={wrapperRef} className="relative self-stretch">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-full flex items-center gap-1 px-2 text-[10px] tabular-nums font-mono',
          open ? 'bg-bg-elevated text-zinc-100' : 'text-zinc-400 hover:text-zinc-100',
        )}
        title="per-role metrics breakdown"
      >
        <ChevronUp
          size={10}
          className={cn(
            'shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
        <span>breakdown</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 z-30 min-w-[280px] rounded-md border border-border-strong bg-bg-elevated shadow-xl shadow-black/40 overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-zinc-400 font-mono font-semibold border-b border-border">
            metrics by role
          </div>
          <table className="w-full text-[10px] font-mono">
            <thead className="text-zinc-500">
              <tr>
                <th className="px-3 py-1 text-left font-normal">role</th>
                <th className="px-3 py-1 text-right font-normal">cost</th>
                <th className="px-3 py-1 text-right font-normal">turns</th>
                <th className="px-3 py-1 text-right font-normal">last</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-center text-zinc-500 italic">
                    no role activity yet
                  </td>
                </tr>
              ) : (
                activeRows.map((r) => (
                  <tr key={r.label} className="border-t border-border/40">
                    <td className={cn('px-3 py-1', r.accent)}>{r.label}</td>
                    <td className="px-3 py-1 text-right text-emerald-300 tabular-nums">
                      ${r.metrics.totalCostUsd.toFixed(4)}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-300 tabular-nums">
                      {r.metrics.totalTurns}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-400 tabular-nums">
                      {r.metrics.lastTurnMs > 0
                        ? `${(r.metrics.lastTurnMs / 1000).toFixed(1)}s`
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function agentCostAccent(agent: string): string {
  if (agent === 'ui-dev') return 'text-violet-400';
  if (agent === 'security') return 'text-rose-400';
  return 'text-zinc-400';
}

function Sep() {
  return <div className="w-px h-3 bg-border self-center mx-0.5" />;
}

function Badge({
  icon,
  label,
  color,
  bg,
  title,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  bg?: string;
  title?: string;
  pulse?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-1 self-stretch tabular-nums truncate',
        bg,
        color,
      )}
      title={title}
    >
      <span className={cn('shrink-0', pulse && 'animate-pulse')}>{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

interface Activity {
  icon: React.ReactNode;
  label: string;
  color: string;
  bg?: string;
  pulse: boolean;
}

function computeActivity(meta: SessionMeta, busy: boolean): Activity {
  if (meta.supActive) {
    return {
      icon: <Activity size={10} />,
      label: 'sup running',
      color: 'text-cyan-300',
      bg: 'bg-cyan-950/40',
      pulse: true,
    };
  }
  if (meta.devActive) {
    return {
      icon: <Activity size={10} />,
      label: 'dev running',
      color: 'text-amber-300',
      bg: 'bg-amber-950/40',
      pulse: true,
    };
  }
  if (busy) {
    return {
      icon: <Activity size={10} />,
      label: 'busy',
      color: 'text-zinc-300',
      pulse: true,
    };
  }
  return {
    icon: <Pause size={10} />,
    label: 'idle',
    color: 'text-zinc-500',
    pulse: false,
  };
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function countOpenTodos(chatLog: ChatLogEntry[]): number {
  // Latest TodoWrite tool call wins (todos are not append-only).
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const e = chatLog[i]!;
    if (e.type !== 'dev-tool-call' || e.name !== 'TodoWrite') continue;
    const todos = (e.input as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return 0;
    return todos.filter(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        (t as { status?: unknown }).status !== 'completed',
    ).length;
  }
  return 0;
}

function countDistinctFiles(chatLog: ChatLogEntry[]): number {
  const seen = new Set<string>();
  for (const e of chatLog) {
    if (e.type !== 'dev-tool-call') continue;
    if (e.name !== 'Read' && e.name !== 'Edit' && e.name !== 'Write') continue;
    const path = (e.input as { file_path?: unknown }).file_path;
    if (typeof path === 'string' && path.length > 0) seen.add(path);
  }
  return seen.size;
}
