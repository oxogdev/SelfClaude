'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/cn';

export function InputBar({
  busy,
  hasPendingQuestion,
  hasPendingApproval,
  onSubmit,
}: {
  busy: boolean;
  hasPendingQuestion: boolean;
  hasPendingApproval: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');

  const placeholder = hasPendingQuestion
    ? 'type answer ↵'
    : hasPendingApproval
      ? 'y to allow, anything else denies ↵'
      : busy
        ? 'working…'
        : 'message supervisor…';

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <div className="border-t border-border bg-bg-panel p-3 flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        disabled={busy && !hasPendingQuestion && !hasPendingApproval}
        rows={1}
        className={cn(
          'flex-1 resize-none bg-bg-subtle border border-border rounded-md px-3 py-2 text-sm',
          'focus:outline-none focus:border-cyan-600',
          'disabled:opacity-50',
          'min-h-[36px] max-h-[160px]',
        )}
        style={{ height: 'auto' }}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || (busy && !hasPendingQuestion && !hasPendingApproval)}
        className={cn(
          'shrink-0 rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-2 text-white',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label="send"
      >
        <Send size={16} />
      </button>
    </div>
  );
}
