'use client';

import { cn } from '@/lib/cn';
import type { ChatLogEntry, SessionMeta } from '@/lib/types';

export interface AgentStatusInfo {
  text: string;
  detail?: string;
}

/**
 * Compute the supervisor's current status from session state.
 * Returns null when supervisor is idle.
 */
export function computeSupStatus(
  meta: SessionMeta | null,
  streamingTs: number | null,
): AgentStatusInfo | null {
  if (!meta?.supActive) return null;
  if (streamingTs !== null) return { text: 'writing' };
  return { text: 'thinking' };
}

/**
 * Compute the developer's current status. Looks at the most recent dev
 * activity in the chat log to surface what tool is currently in flight.
 */
export function computeDevStatus(
  meta: SessionMeta | null,
  chatLog: ChatLogEntry[],
  streamingTs: number | null,
): AgentStatusInfo | null {
  if (!meta?.devActive) return null;
  // Walk backwards looking for the latest tool_use that doesn't yet have a
  // tool_result — that's what the developer is currently executing.
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const e = chatLog[i]!;
    if (e.type === 'dev-tool-call') {
      const resolved = chatLog.some(
        (r) => r.type === 'dev-tool-result' && r.toolUseId === e.toolUseId,
      );
      if (!resolved) {
        return { text: `running ${e.name}`, detail: summarizeToolInput(e.name, e.input) };
      }
      break;
    }
    if (e.type === 'dev-text' || e.type === 'sup-message') break;
  }
  if (streamingTs !== null) return { text: 'writing' };
  return { text: 'working' };
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'Bash') {
    const cmd = String(input.command ?? '');
    return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
  }
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    const p = String(input.file_path ?? '');
    return p.length > 60 ? `…${p.slice(-57)}` : p;
  }
  if (name === 'Grep' || name === 'Glob') {
    return String(input.pattern ?? '');
  }
  return undefined;
}

export function AgentStatus({
  status,
  variant,
}: {
  status: AgentStatusInfo | null;
  variant: 'sup' | 'dev';
}) {
  if (!status) return null;
  const color = variant === 'sup' ? 'text-cyan-400' : 'text-amber-400';
  return (
    <div
      className={cn(
        'px-3 py-1.5 text-xs flex items-center gap-2 border-t border-border bg-bg-subtle/60',
        color,
      )}
    >
      <span className="typing-dots">
        <span />
        <span />
        <span />
      </span>
      <span>{variant === 'sup' ? 'supervisor' : 'developer'}</span>
      <span className="text-zinc-500">·</span>
      <span>{status.text}</span>
      {status.detail && (
        <>
          <span className="text-zinc-500">·</span>
          <code className="text-zinc-300 truncate max-w-[400px]">{status.detail}</code>
        </>
      )}
    </div>
  );
}
