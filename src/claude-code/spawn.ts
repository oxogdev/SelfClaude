import { spawn } from 'node:child_process';
import {
  StreamJsonParser,
  extractSessionId,
  type ParseError,
  type StreamEvent,
} from '../orchestrator/stream-parser.js';

export type Role = 'supervisor' | 'developer';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

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
      env: { ...process.env, ...opts.envOverrides },
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
