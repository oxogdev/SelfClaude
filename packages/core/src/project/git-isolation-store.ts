import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Phase 5 (Trust v1) — persistence for git-isolation state.
 *
 * The git-isolation primitives in `packages/core/src/server/
 * git-isolation.ts` are stateless — every call takes branch +
 * originalBranch as input. This file persists those names so a
 * daemon restart doesn't forget which branch belongs to which
 * session, and the frontend can drive Accept/Discard without
 * having to remember the originalBranch the operator was on when
 * isolation was enabled.
 *
 * Lives at `<cwd>/.selfclaude/git-isolation.json`. Mirrored on every
 * lifecycle change (start / accept / discard); read on session boot.
 *
 * Single-tenant — one isolation state per workspace at a time. If
 * the operator wants to enable isolation again after accept/discard,
 * the file is rewritten with a fresh entry.
 */

export const GitIsolationFileSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  /** SC session branch (e.g. `selfclaude/abc-1234`). */
  branch: z.string().min(1),
  /** The branch the operator was on when isolation was enabled. */
  originalBranch: z.string().min(1),
  /** ms since epoch — when start succeeded. */
  startedAt: z.number(),
  /** ms since epoch — last commit timestamp; null until a turn commits. */
  lastCommitAt: z.number().nullable(),
});
export type GitIsolationFile = z.infer<typeof GitIsolationFileSchema>;

const FILENAME = 'git-isolation.json';

function isolationPath(cwd: string): string {
  // Test override: when SELFCLAUDE_GIT_ISOLATION_PATH is set the path
  // is taken verbatim. Production never sets it.
  return process.env.SELFCLAUDE_GIT_ISOLATION_PATH ?? join(cwd, '.selfclaude', FILENAME);
}

export async function readGitIsolation(cwd: string): Promise<GitIsolationFile | null> {
  const target = isolationPath(cwd);
  if (!existsSync(target)) return null;
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON — treat as no state. The operator can reset by
    // running accept/discard manually; we don't auto-clean here.
    return null;
  }
  const result = GitIsolationFileSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export async function writeGitIsolation(
  cwd: string,
  data: GitIsolationFile,
): Promise<void> {
  const target = isolationPath(cwd);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function clearGitIsolation(cwd: string): Promise<void> {
  const target = isolationPath(cwd);
  if (!existsSync(target)) return;
  try {
    await unlink(target);
  } catch {
    /* race with concurrent clear — ignore */
  }
}

/**
 * Update only the `lastCommitAt` field, leaving the rest intact.
 * Called from the auto-commit hook after each successful turn so the
 * UI's "last commit" indicator stays current without rewriting the
 * whole record's worth of metadata.
 *
 * No-op when the file doesn't exist — auto-commit can race with
 * accept/discard, which clears the file mid-flight. We don't want a
 * stale ts to recreate cleared state.
 */
export async function bumpLastCommitAt(cwd: string, ts: number): Promise<void> {
  const current = await readGitIsolation(cwd);
  if (!current) return;
  await writeGitIsolation(cwd, { ...current, lastCommitAt: ts });
}
