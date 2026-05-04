'use client';

import { useEffect, useRef } from 'react';
import { Wrench, MessageSquare, FileText, Compass, StickyNote } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ChatLogEntry } from '@/lib/types';

export function DevTimeline({
  chatLog,
  selectedToolUseId,
  onSelectTool,
}: {
  chatLog: ChatLogEntry[];
  selectedToolUseId: string | null;
  onSelectTool: (toolUseId: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Pair tool_use ↔ tool_result entries by toolUseId so each tool renders as
  // a single card with status.
  const items = buildItems(chatLog);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [items.length]);

  return (
    <div
      ref={ref}
      className="h-full overflow-y-auto scrollbar-thin px-3 py-3 space-y-2"
    >
      {items.length === 0 && (
        <p className="text-sm text-zinc-500 italic px-2">No developer activity yet.</p>
      )}
      {items.map((item) => {
        if (item.kind === 'tool') {
          const isSel = item.toolUseId === selectedToolUseId;
          return (
            <button
              key={item.toolUseId}
              onClick={() => onSelectTool(isSel ? null : item.toolUseId)}
              className={cn(
                'w-full text-left rounded-md border p-2.5 text-sm transition-colors',
                isSel
                  ? 'border-cyan-500/60 bg-cyan-950/30'
                  : 'border-border bg-bg-panel hover:bg-bg-elevated',
              )}
            >
              <div className="flex items-center gap-2">
                <Wrench size={14} className="text-blue-400 shrink-0" />
                <code className="text-blue-300 font-medium">{item.name}</code>
                {item.summary && (
                  <code className="text-zinc-400 truncate text-xs">{item.summary}</code>
                )}
              </div>
              {item.result !== undefined && (
                <div
                  className={cn(
                    'mt-1.5 ml-5 text-xs flex items-center gap-1.5',
                    item.isError ? 'text-red-400' : 'text-emerald-400',
                  )}
                >
                  <span>{item.isError ? '✗' : '✓'}</span>
                  <span className="truncate">{firstLine(item.result) || (item.isError ? 'error' : 'ok')}</span>
                </div>
              )}
              {item.result === undefined && (
                <div className="mt-1 ml-5 text-xs text-zinc-500">(running…)</div>
              )}
            </button>
          );
        }
        if (item.kind === 'text') {
          return (
            <div
              key={item.key}
              className="flex items-start gap-2 px-2 py-1 text-sm text-zinc-200"
            >
              <MessageSquare size={14} className="text-zinc-500 mt-1 shrink-0" />
              <p className="whitespace-pre-wrap leading-relaxed">{item.text}</p>
            </div>
          );
        }
        if (item.kind === 'task-marker') {
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 px-2 py-1 text-xs text-cyan-400 italic border-l-2 border-cyan-700 ml-1"
            >
              <Compass size={12} />
              <span>sup → dev: {item.summary}</span>
            </div>
          );
        }
        if (item.kind === 'phase-doc') {
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 px-2 py-1 text-xs text-emerald-500 italic"
            >
              <FileText size={12} />
              <span>wrote docs/phases/{item.filename}</span>
            </div>
          );
        }
        if (item.kind === 'user-note') {
          return (
            <div
              key={item.key}
              className="flex items-start gap-2 rounded-md border border-magenta-700/40 border-amber-700/40 bg-amber-950/20 px-3 py-2 text-sm"
            >
              <StickyNote size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-amber-400 mb-0.5">your note for dev</div>
                <p className="text-amber-100 whitespace-pre-wrap">{item.text}</p>
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

type TimelineItem =
  | {
      kind: 'tool';
      toolUseId: string;
      name: string;
      summary: string;
      input: Record<string, unknown>;
      result?: string;
      isError?: boolean;
    }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'task-marker'; key: string; summary: string }
  | { kind: 'phase-doc'; key: string; filename: string }
  | { kind: 'user-note'; key: string; text: string };

function buildItems(chatLog: ChatLogEntry[]): TimelineItem[] {
  const tools = new Map<string, Extract<TimelineItem, { kind: 'tool' }>>();
  const out: TimelineItem[] = [];
  for (const entry of chatLog) {
    if (entry.type === 'dev-tool-call') {
      const item: TimelineItem = {
        kind: 'tool',
        toolUseId: entry.toolUseId,
        name: entry.name,
        summary: summarizeToolInput(entry.name, entry.input),
        input: entry.input,
      };
      tools.set(entry.toolUseId, item);
      out.push(item);
    } else if (entry.type === 'dev-tool-result') {
      const tool = tools.get(entry.toolUseId);
      if (tool) {
        tool.result = entry.text;
        tool.isError = entry.isError;
      }
    } else if (entry.type === 'dev-text') {
      out.push({ kind: 'text', key: `${entry.ts}-text`, text: entry.text });
    } else if (entry.type === 'task-marker') {
      out.push({ kind: 'task-marker', key: `${entry.ts}-task`, summary: entry.summary });
    } else if (entry.type === 'phase-doc-written') {
      out.push({ kind: 'phase-doc', key: `${entry.ts}-doc`, filename: entry.filename });
    } else if (entry.type === 'user-note-dev') {
      out.push({ kind: 'user-note', key: `${entry.ts}-note`, text: entry.text });
    }
  }
  return out;
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') {
    return String(input.command ?? '');
  }
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return String(input.file_path ?? '');
  }
  if (name === 'Grep' || name === 'Glob') {
    return String(input.pattern ?? '');
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length < 80) return v;
  }
  return '';
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  const line = (i === -1 ? s : s.slice(0, i)).trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
