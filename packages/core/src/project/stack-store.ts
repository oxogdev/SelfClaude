import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Per-project structured tech-stack manifest.
 *
 * Lives at `<cwd>/.selfclaude/stack.json`. Captures every "what library
 * / framework / runtime / version are we on?" decision in one place so
 * the supervisor + every specialist agent + the operator share a single
 * source of truth. Agents query individual categories on demand (token
 * saver) rather than dumping the whole manifest into every prompt.
 *
 * Schema is intentionally flat: a list of items each tagged with a
 * `category` + `name`. This keeps add/remove cheap and lets the UI
 * present a category-grouped form without a deeply-nested object that
 * would force schema migrations every time a new dimension is added.
 *
 * Locking: when `locked` is true, the operator is signalling "this is a
 * hard constraint, agents must honour it; do not propose alternatives."
 * Unlocked items are still recorded but the operator is OK with agents
 * suggesting changes.
 */

export const StackItemSchema = z.object({
  /** Broad bucket — `language` / `frontend` / `backend` / `db` / `auth` / etc. */
  category: z.string().min(1),
  /** Specific dimension within the category (`framework`, `runtime`, `ui-lib`). */
  name: z.string().min(1),
  /** Concrete value (`Next.js`, `Postgres`, `shadcn`, `Bun`). */
  value: z.string().min(1),
  /** Version pin or constraint (`15.x`, `^22.0`, `latest`). */
  version: z.string().default(''),
  /** Operator-set hard constraint — agents must NOT propose changes. */
  locked: z.boolean().default(false),
  /** Free-form annotation surfaced to agents on query. */
  notes: z.string().default(''),
});

export const StackFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  items: z.array(StackItemSchema).default([]),
});

export type StackItem = z.infer<typeof StackItemSchema>;
export type StackFile = z.infer<typeof StackFileSchema>;

export function stackPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'stack.json');
}

export async function readStack(cwd: string): Promise<StackFile> {
  const path = stackPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), items: [] };
  }
  try {
    const json: unknown = JSON.parse(raw);
    return StackFileSchema.parse(json);
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), items: [] };
  }
}

export async function writeStack(cwd: string, file: StackFile): Promise<void> {
  const path = stackPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  file.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}
