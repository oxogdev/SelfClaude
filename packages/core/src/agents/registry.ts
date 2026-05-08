import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectAgentPromptPath, readProjectAgentPrompt } from './dna.js';

/**
 * Agent registry — the ground truth for what roles exist in the multi-
 * agent topology, what their default capabilities are, and where their
 * system prompts live on disk.
 *
 * v1.0 ships **six** built-in roles (Phase 8 hard cap):
 *
 *   • supervisor — the always-on lead. Plans, delegates, gates phases.
 *   • developer  — the backend / general-purpose implementation agent.
 *   • ui-dev     — the frontend / admin-panel specialist (shadcn + tailwind).
 *   • security   — read-only reviewer that audits diffs before phase close.
 *   • tester     — verification-only specialist. Adds and runs tests; does
 *                  not change product code paths.
 *   • refactorer — bounded-scope rework specialist. Renames, deduplicates,
 *                  splits files; never adds features or new dependencies.
 *
 * **Hard cap on built-in roles (Phase 8 / ROADMAP calibration #8).** No
 * further agents land in core for v1.0. Additional roles ride via the
 * project-local override at `<cwd>/.selfclaude/agents.json` or the
 * user-global one at `~/.selfclaude/agents.json` (loader pending in
 * Sprint 2.5). The cap exists because each new agent multiplies the
 * delegation surface — more contracts, more failure modes, more places
 * sup can pick wrong.
 *
 * Performance discipline: every read of an agent's system prompt is
 * cached after first load. Prompts can be hot-edited from the UI, so the
 * cache is keyed by file mtime and re-read when stale.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(HERE, '..', 'claude-code', 'system-prompts');

/** Roles the orchestrator gives special handling. */
export type BuiltInAgentName =
  | 'supervisor'
  | 'developer'
  | 'ui-dev'
  | 'security'
  | 'tester'
  | 'refactorer';

/**
 * Static configuration for one agent role. The system-prompt path can be
 * absolute (typically a user-configured override) or a bare filename
 * resolved against `system-prompts/`.
 */
export interface AgentConfig {
  /** Stable role identifier — used in `<TASK_FOR_DEVELOPER agent="..."/>`. */
  name: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Markdown system prompt file (path or filename). */
  systemPromptFile: string;
  /**
   * Whether the supervisor can summon this agent on demand. Always
   * `false` for the supervisor itself (it's always present).
   */
  spawnable: boolean;
  /**
   * Read-only agents can call read tools (Read, Grep, Bash for inspection)
   * but not Edit/Write. The orchestrator enforces this by setting
   * `permissionMode` accordingly when spawning the CC subprocess.
   */
  readOnly: boolean;
  /**
   * UI accent colour for the role tab / status indicator. Hex or tailwind
   * classname-friendly string ("amber" / "rose" / "violet" / "emerald").
   */
  accent: 'cyan' | 'amber' | 'violet' | 'rose' | 'emerald' | 'zinc';
  /**
   * Free-form description for the operator (rendered in settings / agent
   * picker UI). Not surfaced to the agent itself.
   */
  description: string;
}

/**
 * Built-in defaults. These are the starting topology; project overrides
 * ride on top via `loadProjectAgents`.
 */
export const BUILTIN_AGENTS: Record<BuiltInAgentName, AgentConfig> = {
  supervisor: {
    name: 'supervisor',
    label: 'Supervisor',
    systemPromptFile: 'supervisor.md',
    spawnable: false,
    readOnly: false,
    accent: 'cyan',
    description:
      "Project-manager agent. Plans, writes phase docs, delegates tasks to specialist agents, " +
      "gates phase completion via <<PHASE_COMPLETE>>. Always running.",
  },
  developer: {
    name: 'developer',
    label: 'Developer',
    systemPromptFile: 'developer.md',
    spawnable: true,
    readOnly: false,
    accent: 'amber',
    description:
      "Backend / general-purpose implementation agent. Writes server code, runs tests, edits " +
      "configs. The default target of <TASK_FOR_DEVELOPER> when no `agent` attribute is set.",
  },
  'ui-dev': {
    name: 'ui-dev',
    label: 'UI Dev',
    systemPromptFile: 'ui-dev.md',
    spawnable: true,
    readOnly: false,
    accent: 'violet',
    description:
      "Frontend specialist focused on admin-panel topology. Strict standards: shadcn/ui + " +
      "Tailwind, no CDN assets, shared/reusable components, native confirms forbidden, " +
      "consistent layouts (sidebar + topbar + content), backend-driven tables/pagination.",
  },
  security: {
    name: 'security',
    label: 'Security',
    systemPromptFile: 'security.md',
    spawnable: true,
    readOnly: true,
    accent: 'rose',
    description:
      "Read-only auditor. Inspects diffs and configs for secrets, injection vectors, auth " +
      "bypass, dependency vulnerabilities. Reports findings to the supervisor; never edits " +
      "code itself.",
  },
  tester: {
    name: 'tester',
    label: 'Tester',
    systemPromptFile: 'tester.md',
    spawnable: true,
    readOnly: false,
    accent: 'emerald',
    description:
      "Verification-only specialist. Adds and runs tests; never edits product code. " +
      "Pairs with developer / ui-dev — they ship the feature, tester writes the suite that " +
      "proves it works (and catches the next regression). Touches `tests/`, `__tests__/`, " +
      "or `*.test.*` files only; refuses tasks that would require changing the system under " +
      "test.",
  },
  refactorer: {
    name: 'refactorer',
    label: 'Refactorer',
    systemPromptFile: 'refactorer.md',
    spawnable: true,
    readOnly: false,
    accent: 'zinc',
    description:
      "Bounded-scope rework specialist. Renames, splits oversized files, deduplicates " +
      "logic, tightens types — without adding features, new dependencies, or new public " +
      "APIs. Refuses scope creep: if a task crosses into 'while we're at it, also add X', " +
      "it bounces back to sup for re-routing.",
  },
};

/** Cache: agent prompt content keyed by absolute file path + mtime ns. */
interface PromptCacheEntry {
  mtimeMs: number;
  content: string;
}
const promptCache = new Map<string, PromptCacheEntry>();

/**
 * Resolve an agent's system-prompt file to an absolute path.
 *
 * Lookup order (first hit wins):
 *
 *   1. User-global override at `~/.selfclaude/system-prompts/<file>` — what
 *      the operator wrote via the in-app Settings modal. Lets the operator
 *      tune any agent's behaviour without touching the bundled package
 *      source.
 *   2. Bundled default at `packages/core/src/claude-code/system-prompts/<file>`.
 *
 * Bare filenames go through this lookup; anything containing a slash is
 * treated as already-absolute (legacy escape hatch for tests).
 */
function resolvePromptPath(systemPromptFile: string): string {
  if (systemPromptFile.includes('/')) return systemPromptFile;
  const override = resolve(homedir(), '.selfclaude', 'system-prompts', systemPromptFile);
  try {
    statSync(override);
    return override;
  } catch {
    // No override — use the bundled default.
  }
  return resolve(PROMPTS_DIR, systemPromptFile);
}

/** Override path for an agent's prompt (where the Settings modal writes). */
export function agentPromptOverridePath(systemPromptFile: string): string {
  return resolve(homedir(), '.selfclaude', 'system-prompts', systemPromptFile);
}

/** Bundled default path for an agent's prompt (read-only reference). */
export function agentPromptDefaultPath(systemPromptFile: string): string {
  return resolve(PROMPTS_DIR, systemPromptFile);
}

/**
 * Load (and cache) the system prompt for an agent. Re-reads from disk
 * when any file in the layered prompt chain changes — the operator can
 * hot-edit prompts via the UI (or the supervisor can apply a DNA
 * template) without restarting the daemon.
 *
 * Layered composition (top to bottom = order in the resulting string):
 *
 *   1. **Base prompt** — bundled `system-prompts/<file>` or its
 *      user-level override at `~/.selfclaude/system-prompts/<file>`.
 *      Carries SelfClaude orchestration rules — phase tracker, the
 *      AgentsRoom, message-bus discipline, propose_item_done. This
 *      layer is always present.
 *   2. **Project addendum** — `<cwd>/.selfclaude/agent-prompts/<file>`
 *      when present. Set by the supervisor at project bootstrap via
 *      `apply_agent_dna` (or hand-edited by the operator). This is the
 *      "DNA" — visual contract, file topology, component catalog,
 *      stack lock for projects of a specific shape (admin panel, etc.).
 *      Optional; non-DNA projects skip this layer entirely.
 *
 * Pass `cwd` to enable the project-addendum layer. Omit (legacy
 * call-sites) and only the base prompt is returned.
 */
export function loadAgentPrompt(agent: AgentConfig, cwd?: string): string {
  const basePath = resolvePromptPath(agent.systemPromptFile);
  let baseStat;
  try {
    baseStat = statSync(basePath);
  } catch (e) {
    throw new Error(
      `Agent "${agent.name}" system-prompt file not found at ${basePath}: ${(e as Error).message}`,
    );
  }
  // Cache key includes the addendum path + its mtime so a freshly-
  // applied DNA invalidates the cache without explicit clearing.
  const addendumPath = cwd ? projectAgentPromptPath(cwd, agent.systemPromptFile) : null;
  let addendumMtime = 0;
  if (addendumPath) {
    try {
      addendumMtime = statSync(addendumPath).mtimeMs;
    } catch {
      addendumMtime = 0; // missing — layer is absent, cache key reflects that
    }
  }
  const cacheKey = `${basePath}|${baseStat.mtimeMs}|${addendumPath ?? ''}|${addendumMtime}`;
  const cached = promptCache.get(cacheKey);
  if (cached && cached.mtimeMs === baseStat.mtimeMs) return cached.content;

  const baseContent = readFileSync(basePath, 'utf8');
  const addendumContent = cwd ? readProjectAgentPrompt(cwd, agent.systemPromptFile) : null;
  const composed = addendumContent
    ? `${baseContent}\n\n---\n\n# Project DNA — additional standards for this project\n\n${addendumContent}`
    : baseContent;

  promptCache.set(cacheKey, { mtimeMs: baseStat.mtimeMs, content: composed });
  return composed;
}

/**
 * Return all known agents — built-ins for now, project overrides will be
 * merged in once we wire the JSON loader (Sprint 2.5).
 */
export function listAgents(): AgentConfig[] {
  return Object.values(BUILTIN_AGENTS);
}

/**
 * Return a specific agent by name, or null if unknown. Callers should
 * default to "developer" when a `<TASK_FOR_DEVELOPER>` block has no
 * explicit `agent="..."` attribute.
 */
export function getAgent(name: string): AgentConfig | null {
  if (name in BUILTIN_AGENTS) return BUILTIN_AGENTS[name as BuiltInAgentName];
  return null;
}

/** Path to the project-local override file, if any. (Loaded in Sprint 2.5.) */
export function projectAgentsPath(cwd: string): string {
  return resolve(cwd, '.selfclaude', 'agents.json');
}

/** Path to the user-global override file. (Loaded in Sprint 2.5.) */
export function globalAgentsPath(): string {
  return resolve(homedir(), '.selfclaude', 'agents.json');
}

/**
 * Reset the prompt cache. Useful for tests or after a manual file edit
 * that bypasses the file-write API.
 */
export function clearPromptCache(): void {
  promptCache.clear();
}
