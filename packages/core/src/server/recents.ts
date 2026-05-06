import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Recent-projects log — small persistent list of cwds the operator has
 * opened, ordered by most recent first. Independent of favorites
 * (Pinned) and the live `sessions` map; used purely to surface a
 * "Recent" section on the landing page so reopening yesterday's work
 * is one click instead of digging through the folder picker.
 *
 * Capped to RECENTS_MAX entries — anything older falls off the tail.
 * Storage shape matches favorites.json so the format stays familiar.
 */

const RECENTS_PATH = join(homedir(), '.selfclaude', 'recents.json');
const RECENTS_MAX = 20;

export const RecentEntrySchema = z.object({
  cwd: z.string(),
  label: z.string(),
  openedAt: z.number(),
});

const RecentsFileSchema = z.object({
  recents: z.array(RecentEntrySchema),
});

export type RecentEntry = z.infer<typeof RecentEntrySchema>;

function loadFile(): { recents: RecentEntry[] } {
  if (!existsSync(RECENTS_PATH)) return { recents: [] };
  try {
    const raw = readFileSync(RECENTS_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = RecentsFileSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    /* corrupted → treat as empty */
  }
  return { recents: [] };
}

function persistFile(data: { recents: RecentEntry[] }): void {
  mkdirSync(dirname(RECENTS_PATH), { recursive: true });
  writeFileSync(RECENTS_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Returns recents in most-recent-first order. Stale entries (cwd no
 * longer exists on disk) are filtered out lazily on read so the UI
 * doesn't have to deal with broken cards. We don't rewrite the file
 * here — pruning happens implicitly the next time `recordRecent`
 * triggers a write.
 */
export function listRecents(): RecentEntry[] {
  const { recents } = loadFile();
  return recents
    .filter((r) => existsSync(r.cwd))
    .slice(0, RECENTS_MAX);
}

/**
 * Record (or refresh) a recent entry. If the cwd already exists, its
 * `openedAt` bumps to now and it floats to the top. Cap enforced.
 */
export function recordRecent(cwd: string, label?: string): RecentEntry {
  const data = loadFile();
  const filtered = data.recents.filter((r) => r.cwd !== cwd);
  const entry: RecentEntry = {
    cwd,
    label: label && label.length > 0 ? label : basename(cwd) || cwd,
    openedAt: Date.now(),
  };
  const next = [entry, ...filtered].slice(0, RECENTS_MAX);
  persistFile({ recents: next });
  return entry;
}

export function removeRecent(cwd: string): boolean {
  const data = loadFile();
  const before = data.recents.length;
  data.recents = data.recents.filter((r) => r.cwd !== cwd);
  if (data.recents.length === before) return false;
  persistFile(data);
  return true;
}

export function clearRecents(): void {
  persistFile({ recents: [] });
}
