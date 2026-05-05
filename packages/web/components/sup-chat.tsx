'use client';

import { useRef } from 'react';
import { AgentStatus, type AgentStatusInfo } from './agent-status';
import { BubbleMarkdown } from './bubble-markdown';
import { useStickyBottom } from './use-sticky-bottom';
import type { ChatLogEntry } from '@/lib/types';

export function SupChat({
  chatLog,
  streamingTs,
  status,
}: {
  chatLog: ChatLogEntry[];
  streamingTs: number | null;
  status: AgentStatusInfo | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyBottom(ref, [chatLog, streamingTs, status]);

  // Filter to supervisor-pane-relevant entries.
  const lines = chatLog.filter(
    (e) =>
      e.type === 'user-message' ||
      e.type === 'sup-message' ||
      e.type === 'phase-doc-written' ||
      (e.type === 'iteration-end' && false),
  );

  return (
    <div className="h-full flex flex-col">
      <div
        ref={ref}
        className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2.5 space-y-2"
      >
        {lines.length === 0 && (
          <p className="text-xs text-zinc-500 italic">
            No messages yet. Type below to start a discovery conversation.
          </p>
        )}
        {lines.map((entry, idx) => (
          <Bubble
            key={`${entry.ts}-${idx}`}
            entry={entry}
            streaming={entry.type === 'sup-message' && entry.ts === streamingTs}
          />
        ))}
      </div>
      <AgentStatus status={status} variant="sup" />
    </div>
  );
}

function Bubble({ entry, streaming = false }: { entry: ChatLogEntry; streaming?: boolean }) {
  if (entry.type === 'user-message') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-cyan-600/20 border border-cyan-700/40 px-3 py-1.5">
          <div className="text-[10px] text-cyan-300/80 mb-0.5 uppercase tracking-wide">you</div>
          <p className="whitespace-pre-wrap bubble-text">{entry.text}</p>
        </div>
      </div>
    );
  }
  if (entry.type === 'sup-message') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] rounded-xl rounded-tl-sm bg-bg-elevated border border-border px-3 py-1.5">
          <div className="text-[10px] text-zinc-400 mb-0.5 uppercase tracking-wide">supervisor</div>
          <BubbleMarkdown streaming={streaming}>{entry.text}</BubbleMarkdown>
        </div>
      </div>
    );
  }
  if (entry.type === 'phase-doc-written') {
    return (
      <div className="text-[10px] text-emerald-500 italic px-2 font-mono">
        📄 wrote docs/phases/{entry.filename}
      </div>
    );
  }
  return null;
}

