import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Per-project MCP tool telemetry. Lives at
 * `<cwd>/.selfclaude/mcp-telemetry.json`. Surfaces "is the supervisor
 * actually using the tool we shipped?" — if `register_phase_items`
 * shows zero calls across multiple projects, the prompt directive is
 * being skipped and we need to refine. If `ask_user` shows a recent
 * spike, sup may be over-asking.
 *
 * Storage choices:
 *   - **Aggregates** (`total`, `success`, `failure`, `lastCalledAt`)
 *     for at-a-glance UI — no scan needed.
 *   - **Recent** ring buffer (last 50 calls) for an audit-style timeline
 *     in the Settings tool drawer. Older calls drop off; the chat-log
 *     keeps the full history if anyone needs forensic detail.
 */

export const ToolCallStatSchema = z.object({
  name: z.string(),
  total: z.number().int().nonnegative().default(0),
  success: z.number().int().nonnegative().default(0),
  failure: z.number().int().nonnegative().default(0),
  lastCalledAt: z.string().nullable().default(null),
  lastFailedAt: z.string().nullable().default(null),
  /** Last N calls (newest first). Bounded by `RECENT_LIMIT` on append. */
  recent: z
    .array(
      z.object({
        ts: z.number(),
        agent: z.string(),
        success: z.boolean(),
        message: z.string().default(''),
      }),
    )
    .default([]),
});
export type ToolCallStat = z.infer<typeof ToolCallStatSchema>;

export const MCPTelemetryFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  tools: z.record(ToolCallStatSchema).default({}),
});
export type MCPTelemetryFile = z.infer<typeof MCPTelemetryFileSchema>;

const RECENT_LIMIT = 50;

export function mcpTelemetryPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'mcp-telemetry.json');
}

function emptyFile(): MCPTelemetryFile {
  return { version: 1, updatedAt: new Date().toISOString(), tools: {} };
}

export async function readMcpTelemetry(cwd: string): Promise<MCPTelemetryFile> {
  const path = mcpTelemetryPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return emptyFile();
  }
  try {
    const json: unknown = JSON.parse(raw);
    return MCPTelemetryFileSchema.parse(json);
  } catch {
    // Corrupt file — start fresh rather than crash the panel.
    return emptyFile();
  }
}

export async function writeMcpTelemetry(
  cwd: string,
  file: MCPTelemetryFile,
): Promise<void> {
  const path = mcpTelemetryPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  file.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Record one MCP tool invocation. Append-only against the recent
 * buffer (capped) and bumps the per-tool aggregates. Caller owns the
 * file write — typical pattern: read, record, write — so multiple
 * recorders in the same turn don't double-write to disk.
 */
export function recordMcpCall(
  file: MCPTelemetryFile,
  args: { name: string; agent: string; success: boolean; message?: string },
): MCPTelemetryFile {
  const ts = Date.now();
  const tsIso = new Date(ts).toISOString();
  const existing = file.tools[args.name] ?? {
    name: args.name,
    total: 0,
    success: 0,
    failure: 0,
    lastCalledAt: null,
    lastFailedAt: null,
    recent: [] as ToolCallStat['recent'],
  };
  const next: ToolCallStat = {
    ...existing,
    total: existing.total + 1,
    success: existing.success + (args.success ? 1 : 0),
    failure: existing.failure + (args.success ? 0 : 1),
    lastCalledAt: tsIso,
    lastFailedAt: args.success ? existing.lastFailedAt : tsIso,
    recent: [
      {
        ts,
        agent: args.agent,
        success: args.success,
        message: args.message ?? '',
      },
      ...existing.recent,
    ].slice(0, RECENT_LIMIT),
  };
  return {
    ...file,
    tools: { ...file.tools, [args.name]: next },
  };
}
