'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Code, Plus, Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { computeDevStatus } from './agent-status';
import { AgentTimeline } from './agent-timeline';
import type { ChatLogEntry, SessionMeta } from '@/lib/types';
import type { DerivedState } from '@/lib/api';

/**
 * Multi-agent dev pane. Renders a horizontal tab strip across every
 * currently-summoned specialist (always at minimum `developer`) and below
 * it the active tab's timeline. Capabilities — scroll, sticky-bottom,
 * lazy load, tool cards, thinking, scroll-to-bottom button, per-tab input
 * bar, wakeup overlay — are identical across agents (delegated to a
 * single `AgentTimeline` component); only the accent colour and label
 * differ. The supervisor is never represented here; it has its own pane.
 */
export function AgentPane({
  meta,
  chatLog,
  selectedToolUseId,
  streamingDevTs,
  onSelectTool,
  busy,
  onSubmitDev,
  onSubmitAgent,
  onLoadMoreHistory,
  hasMoreHistory,
  loadingHistory,
  wakeups,
  derived,
}: {
  meta: SessionMeta | null;
  chatLog: ChatLogEntry[];
  selectedToolUseId: string | null;
  streamingDevTs: number | null;
  onSelectTool: (toolUseId: string | null) => void;
  busy: boolean;
  onSubmitDev: (text: string) => void;
  onSubmitAgent: (agent: string, text: string) => void;
  onLoadMoreHistory: () => void;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  wakeups: DerivedState['wakeups'] | null;
  derived: DerivedState | null;
}) {
  const activeAgents = useMemo(() => {
    const all = derived?.activeAgents ?? ['developer'];
    const others = all.filter((a) => a !== 'developer');
    return ['developer', ...others];
  }, [derived?.activeAgents]);

  // Last activity ts per agent — used both for the green-pulse indicator
  // on the tab AND for the smart-default landing tab.
  const lastAgentTs = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of chatLog) {
      if (e.type === 'dev-tool-call' || e.type === 'dev-text' || e.type === 'dev-thinking') {
        map.set('developer', Math.max(map.get('developer') ?? 0, e.ts));
      } else if (
        e.type === 'agent-tool-call' ||
        e.type === 'agent-text' ||
        e.type === 'agent-thinking' ||
        e.type === 'agent-tool-result'
      ) {
        map.set(e.agent, Math.max(map.get(e.agent) ?? 0, e.ts));
      }
    }
    return map;
  }, [chatLog]);

  // Smart-default tab: most-recently-active. If no agent has activity in
  // the visible window (cold reload + everything in older history), fall
  // back to the last-summoned specialist (developer is at index 0).
  const defaultActiveTab = useMemo(() => {
    let bestAgent: string | null = null;
    let bestTs = 0;
    for (const agent of activeAgents) {
      const ts = lastAgentTs.get(agent) ?? 0;
      if (ts > bestTs) {
        bestTs = ts;
        bestAgent = agent;
      }
    }
    if (bestAgent) return bestAgent;
    if (activeAgents.length > 1) return activeAgents[activeAgents.length - 1]!;
    return 'developer';
  }, [activeAgents, lastAgentTs]);

  // Tick state to refresh tab activity indicators (live/recent/idle)
  // even when chatLog doesn't change. Keeps the "running" pulse honest:
  // without it, an agent that finished 4 seconds ago would still show
  // as "live" until the next event lands.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const effectiveTab =
    activeTab && activeAgents.includes(activeTab) ? activeTab : defaultActiveTab;

  /**
   * Auto-jump to a newly-summoned specialist. When `activeAgents` grows
   * (sup just summoned ui-dev / security / etc.), we switch the operator
   * over so they see the new agent's work immediately. The previous
   * activeAgents list is held in a ref so we only react to growth, not
   * to every chatLog tick.
   */
  const prevActiveAgentsRef = useRef<string[]>(activeAgents);
  useEffect(() => {
    const prev = prevActiveAgentsRef.current;
    const newcomers = activeAgents.filter((a) => !prev.includes(a));
    prevActiveAgentsRef.current = activeAgents;
    if (newcomers.length === 0) return;
    // Pick the LAST newcomer (most recently summoned). Skip pure
    // 'developer' bumps — that's the default state, not a new specialist.
    const target = newcomers[newcomers.length - 1]!;
    if (target === 'developer') return;
    setActiveTab(target);
  }, [activeAgents]);

  // Status only meaningful for the developer (per-specialist status would
  // need its own per-agent compute; kept null until we add that).
  const devStatus = useMemo(
    () =>
      effectiveTab === 'developer'
        ? computeDevStatus(meta, chatLog, streamingDevTs)
        : null,
    [meta, chatLog, streamingDevTs, effectiveTab],
  );

  /**
   * Submit handler for the unified timeline's input bar. Dispatches to
   * the right back-channel based on which agent owns the active tab.
   */
  const handleSubmit = (text: string) => {
    if (effectiveTab === 'developer') onSubmitDev(text);
    else onSubmitAgent(effectiveTab, text);
  };

  return (
    <div className="h-full flex flex-col min-w-0">
      {activeAgents.length > 1 && (
        <div className="flex items-stretch border-b border-border bg-bg-subtle h-7 shrink-0">
          {activeAgents.map((agent) => (
            <AgentTab
              key={agent}
              agent={agent}
              active={agent === effectiveTab}
              lastTs={lastAgentTs.get(agent) ?? 0}
              onClick={() => setActiveTab(agent)}
            />
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <AgentTimeline
          // The key forces a remount on tab change so the timeline's
          // sticky-bottom + scroll position resets cleanly per agent —
          // otherwise switching between two long timelines would carry
          // the previous tab's scroll offset over.
          key={effectiveTab}
          agent={effectiveTab}
          chatLog={chatLog}
          selectedToolUseId={selectedToolUseId}
          streamingTs={effectiveTab === 'developer' ? streamingDevTs : null}
          onSelectTool={onSelectTool}
          busy={busy}
          onSubmit={handleSubmit}
          onLoadMoreHistory={onLoadMoreHistory}
          hasMoreHistory={hasMoreHistory}
          loadingHistory={loadingHistory}
          wakeups={wakeups}
          status={devStatus}
        />
      </div>
    </div>
  );
}

const AGENT_ICON: Record<string, React.ElementType> = {
  developer: Code,
  'ui-dev': Code,
  security: Shield,
};

const AGENT_TAB_ACCENT: Record<string, { active: string; idle: string; dot: string }> = {
  developer: {
    active: 'border-amber-500 text-amber-200 bg-amber-950/30',
    idle: 'border-transparent text-zinc-400 hover:text-zinc-100',
    dot: 'bg-amber-400',
  },
  'ui-dev': {
    active: 'border-violet-500 text-violet-200 bg-violet-950/30',
    idle: 'border-transparent text-zinc-400 hover:text-zinc-100',
    dot: 'bg-violet-400',
  },
  security: {
    active: 'border-rose-500 text-rose-200 bg-rose-950/30',
    idle: 'border-transparent text-zinc-400 hover:text-zinc-100',
    dot: 'bg-rose-400',
  },
};

function AgentTab({
  agent,
  active,
  lastTs,
  onClick,
}: {
  agent: string;
  active: boolean;
  lastTs: number;
  onClick: () => void;
}) {
  const Icon = AGENT_ICON[agent] ?? Plus;
  const accent = AGENT_TAB_ACCENT[agent] ?? AGENT_TAB_ACCENT.developer!;

  // Three activity tiers based on most-recent event timestamp:
  //   live    — last 3s; agent is currently producing output → "running"
  //   recent  — last 30s; just finished, fading out → solid dot
  //   idle    — older or never; no indicator
  const ageMs = lastTs > 0 ? Date.now() - lastTs : Number.POSITIVE_INFINITY;
  const live = ageMs < 3_000;
  const recent = !live && ageMs < 30_000;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 border-b-2 text-[11px] font-mono uppercase tracking-wide transition-colors',
        active ? accent.active : accent.idle,
      )}
    >
      <Icon size={12} />
      {agent}
      {live && (
        <>
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full animate-pulse',
              accent.dot,
            )}
            title="streaming now"
          />
          <span className={cn('lowercase tracking-normal italic', accent.idle.includes('text-') ? '' : '')}>
            running
          </span>
        </>
      )}
      {recent && !live && (
        <span
          className={cn('inline-block w-1.5 h-1.5 rounded-full', accent.dot)}
          title="recent activity"
        />
      )}
    </button>
  );
}

