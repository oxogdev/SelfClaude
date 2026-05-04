'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import type { ChatLogEntry } from '@/lib/types';

export function SupChat({ chatLog }: { chatLog: ChatLogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);

  // Filter to supervisor-pane-relevant entries.
  const lines = chatLog.filter(
    (e) =>
      e.type === 'user-message' ||
      e.type === 'sup-message' ||
      e.type === 'phase-doc-written' ||
      (e.type === 'iteration-end' && false), // hide iteration-end from sup pane
  );

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={ref}
      className="h-full overflow-y-auto scrollbar-thin px-4 py-3 space-y-3"
    >
      {lines.length === 0 && (
        <p className="text-sm text-zinc-500 italic">
          No messages yet. Type below to start a discovery conversation.
        </p>
      )}
      {lines.map((entry, idx) => (
        <Bubble key={`${entry.ts}-${idx}`} entry={entry} />
      ))}
    </div>
  );
}

function Bubble({ entry }: { entry: ChatLogEntry }) {
  if (entry.type === 'user-message') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-magenta-600 bg-cyan-600/20 border border-cyan-700/40 px-4 py-2 text-sm">
          <div className="text-xs text-cyan-300/80 mb-0.5">you</div>
          <p className="whitespace-pre-wrap">{entry.text}</p>
        </div>
      </div>
    );
  }
  if (entry.type === 'sup-message') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-bg-elevated border border-border px-4 py-2 text-sm">
          <div className="text-xs text-zinc-400 mb-0.5">supervisor</div>
          <p className={cn('whitespace-pre-wrap', containsTaskTag(entry.text) && 'text-zinc-300')}>
            {entry.text}
          </p>
        </div>
      </div>
    );
  }
  if (entry.type === 'phase-doc-written') {
    return (
      <div className="text-xs text-emerald-500 italic px-2">
        📄 wrote docs/phases/{entry.filename}
      </div>
    );
  }
  return null;
}

function containsTaskTag(text: string): boolean {
  return /<TASK_FOR_DEVELOPER>/.test(text);
}
