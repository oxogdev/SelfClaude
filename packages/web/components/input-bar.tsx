'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface InputBarProps {
  variant: 'sup' | 'dev';
  busy?: boolean;
  hasPendingQuestion?: boolean;
  hasPendingApproval?: boolean;
  onSubmit: (text: string) => void;
}

export function InputBar({
  variant,
  busy = false,
  hasPendingQuestion = false,
  hasPendingApproval = false,
  onSubmit,
}: InputBarProps) {
  const [text, setText] = useState('');

  const isSup = variant === 'sup';
  const placeholder = isSup
    ? hasPendingQuestion
      ? 'type answer ↵'
      : hasPendingApproval
        ? 'y to allow, anything else denies ↵'
        : busy
          ? 'working…'
          : 'message supervisor ↵'
    : busy
      ? 'working…'
      : 'message developer ↵';

  const ringColor = isSup ? 'focus:border-cyan-600' : 'focus:border-amber-600';
  const buttonColor = isSup
    ? 'bg-cyan-600 hover:bg-cyan-500'
    : 'bg-amber-600 hover:bg-amber-500';
  const labelText = isSup ? 'sup' : 'dev';
  const labelColor = isSup ? 'text-cyan-400' : 'text-amber-400';

  // Both inputs are disabled while a turn is busy (no pending Q/A bypass
  // for either; a single turn runs at a time). Sup keeps its Q/A bypass.
  const disabled = busy && !(isSup && (hasPendingQuestion || hasPendingApproval));

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <div className={cn('flex items-end gap-1.5 border-t border-border bg-bg-panel p-1.5')}>
      <div
        className={cn(
          'text-[10px] font-mono uppercase tracking-wide self-center min-w-[22px]',
          labelColor,
        )}
      >
        {labelText}
      </div>
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
        disabled={disabled}
        rows={1}
        className={cn(
          'flex-1 resize-none bg-bg-subtle border border-border rounded px-2 py-1 text-[12px] leading-snug',
          'focus:outline-none',
          ringColor,
          'disabled:opacity-50',
          'min-h-[26px] max-h-[140px]',
        )}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || disabled}
        className={cn(
          'shrink-0 rounded px-2.5 py-1 text-white',
          buttonColor,
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label={isSup ? 'send to supervisor' : 'send to developer'}
      >
        <Send size={13} />
      </button>
    </div>
  );
}
