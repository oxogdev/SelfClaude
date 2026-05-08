import { spawn } from 'node:child_process';
import {
  StreamJsonParser,
  extractSessionId,
  type ParseError,
  type StreamEvent,
} from '../orchestrator/stream-parser.js';

export type Role = 'supervisor' | 'developer';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * Env vars stripped from the inherited environment before forwarding to a
 * Claude Code subprocess. Two reasons (defence in depth):
 *
 *   • SelfClaude operator credentials (Telegram bot token + chat id) have
 *     no business inside an agent's process. Even if the agent's prompt
 *     never asks for them, an env leak via tool output, an `env` Bash
 *     call, or a misconfigured logger could exfiltrate them.
 *
 *   • Anthropic credentials (API key, base URL, version) belong to
 *     Claude Code's own configuration (`~/.claude/settings.json`).
 *     SelfClaude never reads them; passing them through the parent
 *     environment just creates duplicate trust paths the operator can't
 *     audit.
 *
 * Anything not in this set passes through unchanged, so the subprocess
 * still inherits PATH, HOME, language settings, etc.
 *
 * Suggested by an external contributor (PR #1, Ersin KOÇ — security pass).
 */
const BLOCKED_ENV_VARS = new Set<string>([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_VERSION',
]);

function buildSubprocessEnv(envOverrides?: Record<string, string>): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!BLOCKED_ENV_VARS.has(k) && v !== undefined) out[k] = v;
  }
  if (envOverrides) {
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

export interface SpawnOptions {
  role: Role;
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  systemPromptAppend?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfig?: string;
  settingsPath?: string;
  /** Pass --chrome to enable Claude in Chrome integration. Default: true. */
  enableChrome?: boolean;
  /** Emit hook lifecycle events into the stream-json output. Default: false. */
  includeHookEvents?: boolean;
  /** Pass --include-partial-messages so callers can render token-level streaming. Default: true. */
  includePartialMessages?: boolean;
  envOverrides?: Record<string, string>;
  signal?: AbortSignal;
  /** Override the binary path (for tests/dev). Default: 'claude'. */
  binary?: string;
}

export interface TurnResult {
  sessionId: string | null;
  events: StreamEvent[];
  exitCode: number | null;
  durationMs: number;
  parserErrors: readonly ParseError[];
  stderr: string;
}

export function buildClaudeArgs(opts: SpawnOptions): string[] {
  const args: string[] = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  if (opts.resumeSessionId) args.push('-r', opts.resumeSessionId);
  if (opts.systemPromptAppend) args.push('--append-system-prompt', opts.systemPromptAppend);
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  if (opts.allowedTools?.length) args.push('--allowed-tools', ...opts.allowedTools);
  if (opts.disallowedTools?.length) args.push('--disallowed-tools', ...opts.disallowedTools);
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
  if (opts.settingsPath) args.push('--settings', opts.settingsPath);
  if (opts.enableChrome !== false) args.push('--chrome');
  if (opts.includeHookEvents) args.push('--include-hook-events');
  if (opts.includePartialMessages !== false) args.push('--include-partial-messages');
  return args;
}

export function buildPromptEnvelope(prompt: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: prompt },
  });
}

/**
 * Spawn a single Claude Code turn over stream-json IPC.
 * The subprocess exits when the turn completes (Stop). Use `runClaudeTurn` again
 * with `resumeSessionId` set to the returned sessionId to continue the conversation.
 */
export function runClaudeTurn(
  opts: SpawnOptions,
  onEvent?: (event: StreamEvent) => void,
): Promise<TurnResult> {
  const args = buildClaudeArgs(opts);
  const start = Date.now();
  const binary = opts.binary ?? 'claude';

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: opts.cwd,
      env: buildSubprocessEnv(opts.envOverrides),
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });

    const parser = new StreamJsonParser();
    const events: StreamEvent[] = [];
    let sessionId: string | null = opts.resumeSessionId ?? null;
    let stderrBuf = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const evt of parser.feed(chunk)) {
        const sid = extractSessionId(evt);
        if (sid) sessionId = sid;
        events.push(evt);
        onEvent?.(evt);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      for (const evt of parser.flush()) {
        const sid = extractSessionId(evt);
        if (sid) sessionId = sid;
        events.push(evt);
        onEvent?.(evt);
      }
      resolve({
        sessionId,
        events,
        exitCode,
        durationMs: Date.now() - start,
        parserErrors: parser.getErrors(),
        stderr: stderrBuf,
      });
    });

    child.stdin.write(`${buildPromptEnvelope(opts.prompt)}\n`);
    child.stdin.end();
  });
}
