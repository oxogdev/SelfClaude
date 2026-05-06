import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Per-project phase tracker — the **structured** source of truth for
 * "what's done in this project right now".
 *
 * Lives at `<cwd>/.selfclaude/phases.json`. Sits alongside (not on top
 * of) the prose `docs/phases/*.md` briefs: docs are free-form
 * descriptions agents read for context; the tracker is a checklist
 * agents and the supervisor mutate via MCP tools as work progresses.
 * Splitting them keeps the supervisor's writing freedom while giving
 * the UI a stable, parser-free progress view.
 *
 * Lifecycle of an item:
 *
 *   - `register_phase_items` (sup, at phase start) → `pending`
 *   - `propose_item_done` (any agent, when they think they're done) → `proposed`
 *   - `confirm_item_done` (sup, after review/test) → `done`
 *   - `reject_item_done` (sup, "missed something") → back to `pending`
 *
 * The trail (proposedBy/At, confirmedBy/At, notes) gives the operator
 * an audit log they can scan in the UI without scrolling chat history.
 */

export const PhaseItemStatusSchema = z.enum(['pending', 'proposed', 'done']);
export type PhaseItemStatus = z.infer<typeof PhaseItemStatusSchema>;

/**
 * Evidence trail captured automatically when the supervisor confirms an
 * item. The orchestrator scans the chat-log between `tsFrom` (proposal
 * time) and `tsTo` (confirmation time), filters for the supervisor's
 * own `Read` / `Bash` / `Edit|Write` tool calls, and records them here.
 *
 * The point isn't to *prove* verification (a model could Read a random
 * file and still rubber-stamp), it's to make rubber-stamping
 * **visible** — operators see an empty trail and know to push back.
 * The supervisor prompt is told the trail is being captured, which is
 * enough caydırıcılık for honest-effort review.
 */
export const ConfirmEvidenceSchema = z.object({
  reads: z
    .array(z.object({ path: z.string(), ts: z.number() }))
    .default([]),
  bashes: z
    .array(
      z.object({
        command: z.string(),
        ts: z.number(),
        isError: z.boolean().default(false),
      }),
    )
    .default([]),
  edits: z
    .array(z.object({ path: z.string(), ts: z.number() }))
    .default([]),
  /** ISO timestamp ms — the proposal time, i.e. the start of the window. */
  tsFrom: z.number(),
  /** ISO timestamp ms — the confirmation time, i.e. window close. */
  tsTo: z.number(),
  /** Convenience sum of reads.length + bashes.length + edits.length. */
  totalCount: z.number().default(0),
});
export type ConfirmEvidence = z.infer<typeof ConfirmEvidenceSchema>;

export const PhaseItemSchema = z.object({
  /** Stable id within a phase. Sup picks slug-style ids when registering. */
  id: z.string().min(1),
  /** Human-readable DoD label, e.g. "Auth middleware wired and unit-tested". */
  title: z.string().min(1),
  status: PhaseItemStatusSchema.default('pending'),
  /** Agent role that proposed completion (`developer`, `ui-dev`, …). */
  proposedBy: z.string().nullable().default(null),
  /** ISO timestamp of the proposal. */
  proposedAt: z.string().nullable().default(null),
  /** Agent (always `supervisor` today) that confirmed completion. */
  confirmedBy: z.string().nullable().default(null),
  /** ISO timestamp of the confirmation. */
  confirmedAt: z.string().nullable().default(null),
  /**
   * Auto-captured tool-call trail covering propose → confirm window. Set
   * by the orchestrator on `confirm_item_done`; null until then. Empty
   * arrays inside the object means "no tool calls during the window" —
   * surfaced as a ⚠ flag in the UI so the operator can spot drive-by
   * confirms.
   */
  confirmEvidence: ConfirmEvidenceSchema.nullable().default(null),
  /**
   * Operator-applied override that resolves an empty-evidence ⚠. When
   * the supervisor confirmed without tool-call evidence, the operator
   * can either request a re-review from sup or — if they verified the
   * work themselves outside the agent loop — mark it operator-verified.
   * The UI uses this flag to hide the ⚠ banner on that item.
   *
   * Only meaningful when `confirmEvidence` is empty; on items that
   * already have a real evidence trail the field is recorded for
   * audit but doesn't change the visual state.
   */
  operatorVerifiedAt: z.string().nullable().default(null),
  operatorVerifiedBy: z.string().nullable().default(null),
  /**
   * Free-form trail. The proposer writes "what I did + how to verify";
   * the confirmer can append "tested with X, looks good" — newest line
   * appended on each transition with a timestamp prefix.
   */
  notes: z.string().default(''),
});
export type PhaseItem = z.infer<typeof PhaseItemSchema>;

export const PhaseSchema = z.object({
  /** Filename slug matching `docs/phases/<slug>.md`, e.g. `01-foundation`. */
  slug: z.string().min(1),
  /** Display title — `Phase 01 — Foundation`. */
  title: z.string().min(1),
  items: z.array(PhaseItemSchema).default([]),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const PhasesFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  phases: z.array(PhaseSchema).default([]),
});
export type PhasesFile = z.infer<typeof PhasesFileSchema>;

export function phasesPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'phases.json');
}

/** Empty tracker. Used as fallback when no file exists or parse fails. */
function emptyPhasesFile(): PhasesFile {
  return { version: 1, updatedAt: new Date().toISOString(), phases: [] };
}

export async function readPhases(cwd: string): Promise<PhasesFile> {
  const path = phasesPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return emptyPhasesFile();
  }
  try {
    const json: unknown = JSON.parse(raw);
    return PhasesFileSchema.parse(json);
  } catch {
    // Corrupt file — better to start fresh than crash the whole panel.
    return emptyPhasesFile();
  }
}

export async function writePhases(cwd: string, file: PhasesFile): Promise<void> {
  const path = phasesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  file.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Replace (or insert) the items for a phase. Existing items with
 * matching `id`s keep their status + audit trail so a re-register
 * doesn't wipe progress; new items land as `pending`; items missing
 * from the new list are dropped (caller is the source of truth on what
 * the phase contains today).
 */
export function mergePhaseRegistration(
  current: PhasesFile,
  reg: { slug: string; title: string; items: Array<{ id: string; title: string }> },
): PhasesFile {
  const existingPhase = current.phases.find((p) => p.slug === reg.slug);
  const existingItems = existingPhase?.items ?? [];
  const mergedItems: PhaseItem[] = reg.items.map((newItem) => {
    const prior = existingItems.find((it) => it.id === newItem.id);
    if (prior) {
      // Keep status/trail, but pick up any title edit from the latest registration.
      return { ...prior, title: newItem.title };
    }
    return {
      id: newItem.id,
      title: newItem.title,
      status: 'pending',
      proposedBy: null,
      proposedAt: null,
      confirmedBy: null,
      confirmedAt: null,
      confirmEvidence: null,
      operatorVerifiedAt: null,
      operatorVerifiedBy: null,
      notes: '',
    };
  });
  const newPhase: Phase = {
    slug: reg.slug,
    title: reg.title,
    items: mergedItems,
  };
  // Replace the phase if present, else append.
  const phases = existingPhase
    ? current.phases.map((p) => (p.slug === reg.slug ? newPhase : p))
    : [...current.phases, newPhase];
  return { ...current, phases };
}

/**
 * Append a timestamped trail line to an item's notes. Keeps the
 * narrative chronological + bounded — caller-supplied text is trimmed
 * and prefixed with ISO time + actor.
 */
export function appendItemNote(notes: string, actor: string, line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return notes;
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${actor}: ${trimmed}`;
  return notes ? `${notes}\n${entry}` : entry;
}

/**
 * Walk a chat-log to build the supervisor's tool-call trail between
 * `tsFrom` (inclusive) and `tsTo` (inclusive). Filters for read-ish /
 * bash / edit-ish tool kinds — every other tool call (Glob, Grep,
 * MCP, ScheduleWakeup, …) is ignored because it's not what we'd
 * expect to back a "I verified this item" claim.
 *
 * Bash entries get their `isError` set from the matching
 * `sup-tool-result`; if the result hasn't been logged yet (race) we
 * default to `false`. Reads/edits don't carry an error flag — the
 * fact that the call happened is the signal.
 *
 * The implementation is intentionally narrow (4 tool names, no agent
 * fan-out) so the audit trail stays interpretable. Future tools that
 * count as verification (e.g. a hypothetical `run_test`) can be added
 * by extending the BASH_LIKE / READ_LIKE / EDIT_LIKE sets.
 */
export interface ChatLogToolCallEntry {
  type: 'sup-tool-call';
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  ts: number;
}
export interface ChatLogToolResultEntry {
  type: 'sup-tool-result';
  toolUseId: string;
  text: string;
  isError: boolean;
  ts: number;
}
type SimpleChatLogEntry = { type: string; ts?: number } & Record<string, unknown>;

const READ_LIKE = new Set(['Read']);
const BASH_LIKE = new Set(['Bash']);
const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit']);

export function computeConfirmEvidence(
  entries: readonly SimpleChatLogEntry[],
  tsFrom: number,
  tsTo: number,
): ConfirmEvidence {
  const reads: ConfirmEvidence['reads'] = [];
  const bashes: ConfirmEvidence['bashes'] = [];
  const edits: ConfirmEvidence['edits'] = [];
  // Index sup-tool-result entries by toolUseId so we can pair errors
  // back to the call cheaply.
  const resultByToolUseId = new Map<string, ChatLogToolResultEntry>();
  for (const e of entries) {
    if (e.type === 'sup-tool-result') {
      const ts = typeof e.ts === 'number' ? e.ts : 0;
      const tid = typeof e.toolUseId === 'string' ? e.toolUseId : '';
      if (tid) {
        resultByToolUseId.set(tid, {
          type: 'sup-tool-result',
          toolUseId: tid,
          text: typeof e.text === 'string' ? e.text : '',
          isError: e.isError === true,
          ts,
        });
      }
    }
  }
  for (const e of entries) {
    if (e.type !== 'sup-tool-call') continue;
    const ts = typeof e.ts === 'number' ? e.ts : 0;
    if (ts < tsFrom || ts > tsTo) continue;
    const name = typeof e.name === 'string' ? e.name : '';
    const input = (e.input as Record<string, unknown> | undefined) ?? {};
    const tid = typeof e.toolUseId === 'string' ? e.toolUseId : '';
    if (READ_LIKE.has(name)) {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      if (path) reads.push({ path, ts });
    } else if (BASH_LIKE.has(name)) {
      const command = typeof input.command === 'string' ? input.command : '';
      if (command) {
        const result = resultByToolUseId.get(tid);
        bashes.push({
          command,
          ts,
          isError: result?.isError ?? false,
        });
      }
    } else if (EDIT_LIKE.has(name)) {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      if (path) edits.push({ path, ts });
    }
  }
  return {
    reads,
    bashes,
    edits,
    tsFrom,
    tsTo,
    totalCount: reads.length + bashes.length + edits.length,
  };
}
