'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Octagon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';
import type { ChatLogEntry, SessionMeta } from '@/lib/types';

export type StatusKind = 'thinking' | 'writing' | 'tool' | 'working';

export interface AgentStatusInfo {
  kind: StatusKind;
  toolName?: string;
  toolDetail?: string;
}

const SUP_PHRASES: Record<StatusKind, string[]> = {
  thinking: [
    'thinking',
    'planning',
    'considering options',
    'analyzing',
    'reasoning',
    'reviewing context',
    'composing reply',
    'mulling it over',
  ],
  writing: ['writing', 'composing', 'drafting'],
  tool: ['working'],
  working: ['working', 'orchestrating', 'coordinating'],
};

const DEV_PHRASES: Record<StatusKind, string[]> = {
  thinking: ['thinking', 'figuring it out', 'planning the next step'],
  writing: ['writing', 'composing answer', 'drafting reply'],
  tool: ['running'],
  working: [
    'working',
    'investigating',
    'reading code',
    'reviewing',
    'iterating',
    'tinkering',
  ],
};

const ROTATION_MS = 14_000;

export function computeSupStatus(
  meta: SessionMeta | null,
  streamingTs: number | null,
): AgentStatusInfo | null {
  if (!meta?.supActive) return null;
  if (streamingTs !== null) return { kind: 'writing' };
  return { kind: 'thinking' };
}

export function computeDevStatus(
  meta: SessionMeta | null,
  chatLog: ChatLogEntry[],
  streamingTs: number | null,
): AgentStatusInfo | null {
  if (!meta?.devActive) return null;
  // Surface the in-flight tool, if any.
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const e = chatLog[i]!;
    if (e.type === 'dev-tool-call') {
      const resolved = chatLog.some(
        (r) => r.type === 'dev-tool-result' && r.toolUseId === e.toolUseId,
      );
      if (!resolved) {
        return {
          kind: 'tool',
          toolName: e.name,
          toolDetail: summarizeToolInput(e.name, e.input),
        };
      }
      break;
    }
    if (e.type === 'dev-text' || e.type === 'sup-message') break;
  }
  if (streamingTs !== null) return { kind: 'writing' };
  return { kind: 'working' };
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
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;
  const [tick, setTick] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [aborting, setAborting] = useState(false);

  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => setTick((t) => t + 1), ROTATION_MS);
    return () => clearInterval(id);
  }, [status]);

  if (!status) return null;

  const colorClass = variant === 'sup' ? 'text-cyan-400' : 'text-amber-400';
  const phrases = variant === 'sup' ? SUP_PHRASES : DEV_PHRASES;

  let labelText: string;
  let detail: string | undefined;
  if (status.kind === 'tool') {
    labelText = `${phrases.tool[tick % phrases.tool.length]} ${status.toolName ?? ''}`.trim();
    detail = status.toolDetail;
  } else {
    const arr = phrases[status.kind];
    labelText = arr[tick % arr.length] ?? arr[0]!;
  }

  const role = variant === 'sup' ? 'supervisor' : 'developer';

  /** Fire the abort. The status bar disappears as soon as the SSE
   *  `turn-busy false` event lands; we don't need any local state for it. */
  const handleAbort = async () => {
    if (!sessionId) return;
    setAborting(true);
    setConfirming(false);
    try {
      await api.abortTurn(sessionId, role);
    } catch (e) {
      console.warn('abortTurn failed:', (e as Error).message);
    } finally {
      setAborting(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'px-3 py-1.5 text-[11px] flex items-center gap-2 border-t border-border bg-bg-subtle/60',
          colorClass,
        )}
      >
        <span className="typing-dots">
          <span />
          <span />
          <span />
        </span>
        <span>{variant === 'sup' ? 'supervisor' : 'developer'}</span>
        <span className="text-zinc-500">·</span>
        <span>{labelText}</span>
        {detail && (
          <>
            <span className="text-zinc-500">·</span>
            <code className="text-zinc-300 truncate max-w-[400px]">{detail}</code>
          </>
        )}
        <button
          onClick={() => setConfirming(true)}
          disabled={aborting}
          className={cn(
            'ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium transition-colors',
            'border-red-800/60 bg-red-950/30 text-red-300 hover:bg-red-900/50 hover:border-red-700',
            'disabled:opacity-50',
          )}
          title={`emergency stop ${role}`}
        >
          <Octagon size={10} />
          stop
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Stop the ${role}?`}
        message={`This will SIGTERM the ${role}'s Claude Code subprocess immediately. Any in-flight tool call will be killed and the turn will end with an error. The session itself stays alive — you can prompt it again afterward.\n\nUse this when the ${role} appears stuck (a hung Bash command, a runaway loop, a wakeup that shouldn't have fired).`}
        confirmLabel="Stop now"
        cancelLabel="Keep running"
        variant="danger"
        onConfirm={handleAbort}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
