import { mkdir, readFile, unlink, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Per-project Bash macro store. The supervisor proposes recurring
 * commands as scripts (`propose_script` MCP tool), the operator
 * approves them via the web UI, and approved scripts get written to
 * `<cwd>/.selfclaude/scripts/<slug>.sh` (chmod 755) so the supervisor
 * can call them through the regular `Bash` tool — no new MCP runtime
 * trust boundary, no sandboxing required, just a curated reusable
 * toolbox the operator has reviewed.
 *
 * Storage:
 *   - **Index file** `<cwd>/.selfclaude/scripts.json` — list of all
 *     proposals (pending / approved / rejected) with metadata + body.
 *   - **Approved files** `<cwd>/.selfclaude/scripts/<slug>.sh` —
 *     written when a proposal flips to `approved`; deleted on reject.
 *
 * Lifecycle:
 *   1. Sup calls `propose_script({slug, body, reason})` → row added
 *      with status `pending`, no file on disk yet.
 *   2. Operator reviews in the Scripts panel → "approve" → file is
 *      written + chmod +x; status flips to `approved`.
 *   3. Or "reject" with a reason → status → `rejected`, no file
 *      written; sup gets the rejection note in its inbox.
 *   4. Sup uses approved scripts via `Bash ./.selfclaude/scripts/<slug>.sh`.
 *
 * The index file is operator-editable via the UI (or `vim`); the
 * orchestrator re-reads it on every mutation so external edits don't
 * desync.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const ScriptProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
]);
export type ScriptProposalStatus = z.infer<typeof ScriptProposalStatusSchema>;

export const ScriptProposalSchema = z.object({
  /** Slug — used as filename `<slug>.sh` and `Bash ./.selfclaude/scripts/<slug>.sh`. */
  slug: z.string().regex(SLUG_RE),
  /** Bash script body the supervisor proposed. */
  body: z.string().min(1).max(8 * 1024),
  /** Why sup wants this — surfaced to the operator on review. */
  reason: z.string().min(1).max(2000),
  status: ScriptProposalStatusSchema.default('pending'),
  /** Agent that proposed (always `supervisor` today; future moderators may change). */
  proposedBy: z.string().min(1),
  /** ISO timestamp when the proposal landed. */
  proposedAt: z.string(),
  /** Operator name (or "operator") that approved/rejected. */
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  /** Operator note attached on approve/reject — surfaced to sup on reject. */
  reviewerNotes: z.string().default(''),
});
export type ScriptProposal = z.infer<typeof ScriptProposalSchema>;

export const ScriptsFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  scripts: z.array(ScriptProposalSchema).default([]),
});
export type ScriptsFile = z.infer<typeof ScriptsFileSchema>;

export function scriptsIndexPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'scripts.json');
}

export function scriptFilePath(cwd: string, slug: string): string {
  return join(cwd, '.selfclaude', 'scripts', `${slug}.sh`);
}

function emptyFile(): ScriptsFile {
  return { version: 1, updatedAt: new Date().toISOString(), scripts: [] };
}

export async function readScripts(cwd: string): Promise<ScriptsFile> {
  const path = scriptsIndexPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return emptyFile();
  }
  try {
    const json: unknown = JSON.parse(raw);
    return ScriptsFileSchema.parse(json);
  } catch {
    return emptyFile();
  }
}

export async function writeScripts(cwd: string, file: ScriptsFile): Promise<void> {
  const path = scriptsIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  file.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Write an approved script to its on-disk location with a friendly
 * shebang + the proposer/operator metadata as a header comment block.
 * The metadata block makes `cat scripts/foo.sh` self-documenting.
 */
export async function writeApprovedScript(
  cwd: string,
  proposal: ScriptProposal,
): Promise<void> {
  const path = scriptFilePath(cwd, proposal.slug);
  await mkdir(dirname(path), { recursive: true });
  const header = [
    '#!/usr/bin/env bash',
    '#',
    `# Proposed by: ${proposal.proposedBy} at ${proposal.proposedAt}`,
    `# Approved by: ${proposal.reviewedBy ?? 'operator'} at ${proposal.reviewedAt ?? new Date().toISOString()}`,
    '#',
    `# Reason: ${proposal.reason.split('\n').join('\n#         ')}`,
    proposal.reviewerNotes
      ? `# Reviewer notes: ${proposal.reviewerNotes.split('\n').join('\n#                  ')}`
      : null,
    '',
    'set -euo pipefail',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const body = proposal.body.endsWith('\n') ? proposal.body : `${proposal.body}\n`;
  await writeFile(path, header + body);
  await chmod(path, 0o755);
}

/** Remove the approved file (used on rejection of a previously-approved script — rare). */
export async function removeApprovedScript(cwd: string, slug: string): Promise<void> {
  try {
    await unlink(scriptFilePath(cwd, slug));
  } catch {
    /* already gone — fine */
  }
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
