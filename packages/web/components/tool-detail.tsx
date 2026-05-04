'use client';

import { Wrench } from 'lucide-react';
import type { ChatLogEntry } from '@/lib/types';

export function ToolDetail({
  chatLog,
  selectedToolUseId,
}: {
  chatLog: ChatLogEntry[];
  selectedToolUseId: string | null;
}) {
  if (!selectedToolUseId) {
    return (
      <div className="h-full p-4 text-sm text-zinc-500 space-y-2">
        <h3 className="font-medium text-zinc-300 mb-3">Detail</h3>
        <p>Click a tool call in the timeline to see its full input and result here.</p>
      </div>
    );
  }

  const call = chatLog.find(
    (e) => e.type === 'dev-tool-call' && e.toolUseId === selectedToolUseId,
  ) as Extract<ChatLogEntry, { type: 'dev-tool-call' }> | undefined;
  const result = chatLog.find(
    (e) => e.type === 'dev-tool-result' && e.toolUseId === selectedToolUseId,
  ) as Extract<ChatLogEntry, { type: 'dev-tool-result' }> | undefined;

  if (!call) {
    return <div className="p-4 text-sm text-zinc-500">Tool call not found.</div>;
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <Wrench size={16} className="text-blue-400" />
        <code className="font-medium text-blue-300">{call.name}</code>
      </div>

      <div>
        <div className="text-xs text-zinc-500 mb-1.5 uppercase tracking-wide">input</div>
        <pre className="bg-bg-subtle border border-border rounded p-3 text-xs whitespace-pre-wrap break-all font-mono text-zinc-200 max-h-[40vh] overflow-y-auto scrollbar-thin">
          {JSON.stringify(call.input, null, 2)}
        </pre>
      </div>

      {result ? (
        <div>
          <div className="text-xs text-zinc-500 mb-1.5 uppercase tracking-wide flex items-center gap-2">
            <span>result</span>
            <span className={result.isError ? 'text-red-400' : 'text-emerald-400'}>
              {result.isError ? '✗ error' : '✓ ok'}
            </span>
          </div>
          <pre className="bg-bg-subtle border border-border rounded p-3 text-xs whitespace-pre-wrap break-words font-mono text-zinc-200 max-h-[40vh] overflow-y-auto scrollbar-thin">
            {result.text || '(empty)'}
          </pre>
        </div>
      ) : (
        <div className="text-xs text-zinc-500 italic">awaiting result…</div>
      )}
    </div>
  );
}
