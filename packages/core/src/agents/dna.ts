import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Agent DNA — bundled, project-level standards documents that opt
 * specific agents into a deeper contract on top of their bundled
 * orchestration prompt.
 *
 * Why a separate concept from `system-prompts/`:
 *
 *   - The `system-prompts/<agent>.md` files in `claude-code/` carry
 *     SelfClaude orchestration rules — phase tracker tools, AgentsRoom
 *     usage, message-bus discipline, propose_item_done flow. Every
 *     instance of that agent across every project needs them.
 *
 *   - DNA is **project-shaped** — the visual contract, the file
 *     topology, the stack lock, the component catalog. Some projects
 *     are admin panels (DNA applies); others are marketing sites or
 *     mobile apps (DNA shouldn't apply, would actively mislead).
 *
 *   - So the supervisor opts IN per-project at bootstrap by calling the
 *     `apply_agent_dna` MCP tool, which copies a bundled template into
 *     `<cwd>/.selfclaude/agent-prompts/<agent>.md`. The agent loader
 *     then APPENDS that file to the bundled system prompt at runtime.
 *
 * Templates ship in `packages/core/src/claude-code/dna-templates/`.
 * Adding a new template = drop the markdown there, register it in
 * `DNA_TEMPLATES` below.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DNA_DIR = resolve(HERE, '..', 'claude-code', 'dna-templates');

export interface DnaTemplate {
  /** Stable slug used as the `dnaSlug` parameter to `apply_agent_dna`. */
  slug: string;
  /** The agent this DNA targets. Today only `ui-dev`; future templates may target others. */
  agent: 'developer' | 'ui-dev' | 'security' | string;
  /** Human-readable name for operator-facing surfaces. */
  label: string;
  /** Short description — when to apply, when not to. */
  description: string;
  /** Filename inside `dna-templates/` (e.g. `admin-panel.md`). */
  file: string;
}

/**
 * The DNA library. Keep this list short and curated — every template
 * is a serious commitment (it appends to every relevant agent turn,
 * eats tokens, sets hard standards). New templates only when a project
 * pattern is repeated enough to deserve canonical capture.
 */
export const DNA_TEMPLATES: Record<string, DnaTemplate> = {
  'admin-panel': {
    slug: 'admin-panel',
    agent: 'ui-dev',
    label: 'Admin Panel DNA',
    description:
      'Strict topology + visual contract for admin panels: shadcn + Tailwind v4, locked stack, ' +
      'sidebar/header layout, AppModal/ConfirmDialog/Drawer family, DataTable + nuqs URL state, ' +
      'react-hook-form + zod, theme tokens, RBAC. Apply when the project is an admin/dashboard ' +
      'with tables, modals, and CRUD flows. Do not apply for marketing sites, landing pages, or ' +
      'frontend apps where the visual contract is bespoke.',
    file: 'admin-panel.md',
  },
};

export function listDnaTemplates(): DnaTemplate[] {
  return Object.values(DNA_TEMPLATES);
}

export function getDnaTemplate(slug: string): DnaTemplate | null {
  return DNA_TEMPLATES[slug] ?? null;
}

/** Absolute path to a bundled DNA template's source file. */
export function dnaTemplatePath(slug: string): string | null {
  const tpl = getDnaTemplate(slug);
  if (!tpl) return null;
  return join(DNA_DIR, tpl.file);
}

/**
 * Where a project's per-agent addendum lives. Paired with
 * `agent-prompts/<file>` so the existing `agents.json` slot can sit
 * next to it without a naming clash.
 */
export function projectAgentPromptPath(cwd: string, systemPromptFile: string): string {
  return resolve(cwd, '.selfclaude', 'agent-prompts', systemPromptFile);
}

/**
 * Read the project-level addendum for an agent if it exists. Returns
 * `null` (not throws) when missing — the loader appends nothing in that
 * case, which is the common path for non-DNA projects.
 */
export function readProjectAgentPrompt(cwd: string, systemPromptFile: string): string | null {
  const path = projectAgentPromptPath(cwd, systemPromptFile);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Copy a DNA template into `<cwd>/.selfclaude/agent-prompts/<agent>.md`.
 * Idempotent by default: if the destination already exists, returns
 * `{ ok: false, reason: 'already-applied' }` so the supervisor can
 * detect a no-op without overwriting any operator hand-edits.
 *
 * Pass `force: true` to overwrite — used by an explicit "reset DNA" UI
 * action down the line, never by default agent flows.
 */
export async function applyAgentDna(
  cwd: string,
  slug: string,
  options: { force?: boolean } = {},
): Promise<
  | { ok: true; destPath: string; agent: string; label: string }
  | { ok: false; reason: 'unknown-template' | 'already-applied' | 'source-missing'; message: string }
> {
  const tpl = getDnaTemplate(slug);
  if (!tpl) {
    return {
      ok: false,
      reason: 'unknown-template',
      message: `Unknown DNA template "${slug}". Available: ${Object.keys(DNA_TEMPLATES).join(', ') || '(none)'}.`,
    };
  }
  const sourcePath = dnaTemplatePath(slug)!;
  try {
    await stat(sourcePath);
  } catch {
    return {
      ok: false,
      reason: 'source-missing',
      message: `Bundled DNA template at ${sourcePath} is missing — package install may be corrupt.`,
    };
  }
  const destPath = projectAgentPromptPath(cwd, `${tpl.agent}.md`);
  if (!options.force && existsSync(destPath)) {
    return {
      ok: false,
      reason: 'already-applied',
      message: `DNA already applied at ${destPath}. Pass force=true to overwrite (rare — usually preserves operator edits).`,
    };
  }
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(sourcePath, destPath);
  return { ok: true, destPath, agent: tpl.agent, label: tpl.label };
}
