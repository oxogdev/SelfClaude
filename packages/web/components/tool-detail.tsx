'use client';

import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/common';
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

  const inputLang = guessInputLanguage(call.name);
  const inputText = formatInput(call.name, call.input);
  const resultLang = guessResultLanguage(call.name, call.input, result?.text ?? '');

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Wrench size={14} className="text-blue-400" />
        <code className="font-medium text-blue-300">{call.name}</code>
      </div>

      <CodeBlock label="input" language={inputLang} code={inputText} />

      {result ? (
        <CodeBlock
          label={result.isError ? '✗ result (error)' : '✓ result'}
          labelColor={result.isError ? 'text-red-400' : 'text-emerald-400'}
          language={resultLang}
          code={result.text || '(empty)'}
        />
      ) : (
        <div className="text-[11px] text-zinc-500 italic">awaiting result…</div>
      )}
    </div>
  );
}

function CodeBlock({
  label,
  labelColor,
  language,
  code,
}: {
  label: string;
  labelColor?: string;
  language: string;
  code: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
      ref.current.innerHTML = html;
    } catch {
      ref.current.textContent = code;
    }
  }, [code, language]);

  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-wide mb-1 ${labelColor ?? 'text-zinc-500'}`}
      >
        {label}
      </div>
      <pre className="bg-bg-subtle border border-border rounded p-2 text-[10px] leading-[13px] whitespace-pre-wrap break-words font-mono text-zinc-200 max-h-[42vh] overflow-y-auto scrollbar-thin">
        <code ref={ref} className={`hljs language-${language}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}

function formatInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') {
    return String(input.command ?? '');
  }
  if (name === 'Write' && typeof input.content === 'string') {
    return String(input.content);
  }
  return JSON.stringify(input, null, 2);
}

function guessInputLanguage(name: string): string {
  if (name === 'Bash') return 'bash';
  if (name === 'Write') return 'plaintext';
  return 'json';
}

function guessResultLanguage(
  name: string,
  input: Record<string, unknown>,
  text: string,
): string {
  if (name === 'Bash') return 'bash';
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    const path = String(input.file_path ?? '');
    return languageFromPath(path);
  }
  // Heuristic: JSON?
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return 'json';
  }
  return 'plaintext';
}

function languageFromPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'xml';
  if (lower.endsWith('.sql')) return 'sql';
  return 'plaintext';
}
