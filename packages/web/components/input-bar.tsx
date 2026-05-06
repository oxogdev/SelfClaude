'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Built-in palette per agent variant. Each entry hands InputBar a fully
 * formed set of Tailwind classes so the visual identity stays in lock-
 * step with the agent tab in the AgentPane (amber dev, violet ui-dev,
 * rose security, …).
 */
const VARIANT_THEME: Record<
  string,
  {
    label: string;
    labelColor: string;
    panelBg: string;
    panelBorder: string;
    inputBg: string;
    inputBorder: string;
    focusRing: string;
    focusBorder: string;
    button: string;
  }
> = {
  sup: {
    label: 'sup',
    labelColor: 'text-cyan-400',
    panelBg: 'bg-cyan-950/20',
    panelBorder: 'border-cyan-900/60',
    inputBg: 'bg-cyan-950/40',
    inputBorder: 'border-cyan-800/70',
    focusRing: 'focus:ring-cyan-500/60',
    focusBorder: 'focus:border-cyan-500',
    button: 'bg-cyan-600 hover:bg-cyan-500',
  },
  developer: {
    label: 'dev',
    labelColor: 'text-amber-400',
    panelBg: 'bg-amber-950/15',
    panelBorder: 'border-amber-900/50',
    inputBg: 'bg-amber-950/30',
    inputBorder: 'border-amber-800/60',
    focusRing: 'focus:ring-amber-500/60',
    focusBorder: 'focus:border-amber-500',
    button: 'bg-amber-600 hover:bg-amber-500',
  },
  'ui-dev': {
    label: 'ui-dev',
    labelColor: 'text-violet-300',
    panelBg: 'bg-violet-950/20',
    panelBorder: 'border-violet-900/60',
    inputBg: 'bg-violet-950/30',
    inputBorder: 'border-violet-800/60',
    focusRing: 'focus:ring-violet-500/60',
    focusBorder: 'focus:border-violet-500',
    button: 'bg-violet-600 hover:bg-violet-500',
  },
  security: {
    label: 'security',
    labelColor: 'text-rose-300',
    panelBg: 'bg-rose-950/20',
    panelBorder: 'border-rose-900/60',
    inputBg: 'bg-rose-950/30',
    inputBorder: 'border-rose-800/60',
    focusRing: 'focus:ring-rose-500/60',
    focusBorder: 'focus:border-rose-500',
    button: 'bg-rose-600 hover:bg-rose-500',
  },
};

const FALLBACK_THEME = VARIANT_THEME.developer!;

export interface InputBarProps {
  /**
   * Visual + label variant. Two well-known shorthands (`sup`, `dev`) plus
   * any agent name in the registry (`ui-dev`, `security`, custom roles).
   * Unknown names fall back to the developer theme so the input bar
   * always renders something sane.
   */
  variant: 'sup' | 'dev' | string;
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
  // 'dev' is an alias for 'developer' so the existing call sites
  // (variant="dev") keep working.
  const themeKey = variant === 'dev' ? 'developer' : variant;
  const theme = VARIANT_THEME[themeKey] ?? FALLBACK_THEME;

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
      : `message ${theme.label} ↵`;

  // Sup keeps its Q/A bypass — even when the conversation is mid-turn,
  // the operator can answer a pending question / approval.
  const disabled = busy && !(isSup && (hasPendingQuestion || hasPendingApproval));

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <div
      className={cn(
        'w-full flex items-end gap-1.5 border-t-2 px-2 py-1.5',
        theme.panelBg,
        theme.panelBorder,
      )}
    >
      <div
        className={cn(
          'text-[10px] font-mono uppercase tracking-widest font-semibold self-center min-w-[26px]',
          theme.labelColor,
        )}
      >
        {theme.label}
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
        rows={2}
        className={cn(
          'flex-1 resize-none border rounded-md px-2.5 py-1.5 text-[12px] leading-snug text-zinc-100 placeholder:text-zinc-500',
          theme.inputBg,
          theme.inputBorder,
          'focus:outline-none focus:ring-1',
          theme.focusRing,
          theme.focusBorder,
          'disabled:opacity-50',
          'min-h-[42px] max-h-[160px]',
        )}
      />
      <button
        onClick={submit}
        disabled={!text.trim() || disabled}
        className={cn(
          'shrink-0 rounded-md px-3 py-2 text-white self-stretch flex items-center',
          theme.button,
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label={`send to ${theme.label}`}
      >
        <Send size={14} />
      </button>
    </div>
  );
}
