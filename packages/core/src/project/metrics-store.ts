import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * On-disk persisted role metrics. Lives at
 * `<cwd>/.selfclaude/metrics.json` so cumulative cost / turn / duration
 * counters survive a daemon restart. Without persistence the bottom
 * toolbar resets to "$0.0000 0 turns" every time the operator restarts
 * the daemon, masking how expensive a project has actually been.
 *
 * The shape mirrors the in-memory `RoleMetrics` interface; we use zod
 * to defensively parse the file in case it was hand-edited or
 * truncated mid-write.
 */
const RoleMetricsSchema = z.object({
  totalCostUsd: z.number().nonnegative(),
  totalTurns: z.number().int().nonnegative(),
  lastTurnMs: z.number().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
  lastResultAt: z.number().nullable(),
});

export const MetricsFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  sup: RoleMetricsSchema,
  dev: RoleMetricsSchema,
  /**
   * Per-specialist counters. The map key is the agent name (`ui-dev`,
   * `security`, custom roles). Optional + defaulted so older metrics
   * files (written before per-agent split landed) parse cleanly.
   */
  agents: z.record(RoleMetricsSchema).default({}),
});

export type MetricsFile = z.infer<typeof MetricsFileSchema>;
export type PersistedRoleMetrics = z.infer<typeof RoleMetricsSchema>;

export function metricsPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'metrics.json');
}

/**
 * Read persisted metrics from disk. Returns null when the file doesn't
 * exist or the content is malformed — caller should fall back to a
 * zero-init in either case.
 */
export async function readMetrics(cwd: string): Promise<MetricsFile | null> {
  const path = metricsPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    return null;
  }
  try {
    const json: unknown = JSON.parse(raw);
    return MetricsFileSchema.parse(json);
  } catch {
    return null;
  }
}

/**
 * Write metrics to disk atomically(-ish): write the JSON in one call so
 * a partial write can't corrupt the previous good state. We don't bother
 * with a temp+rename dance because the file is tiny and a torn write at
 * power-loss is acceptable (we'd just zero-init next boot).
 */
export async function writeMetrics(cwd: string, file: MetricsFile): Promise<void> {
  const path = metricsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}
