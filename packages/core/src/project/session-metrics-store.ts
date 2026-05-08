import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Session-metrics event log — Phase 2 of ROADMAP.md (Telemetry).
 *
 * An append-only JSONL store at `<cwd>/.selfclaude/session-metrics.jsonl`
 * that captures per-session activity events. The collector hooks into
 * orchestrator emits in session-manager.ts and writes one event per
 * action; rollups are computed on read by `computeRollup()`.
 *
 * Why a separate file from the existing `<cwd>/.selfclaude/metrics.json`:
 * the latter is the cumulative role-cost ledger (sup/dev/agents × turns,
 * cost, duration) that already exists for the bottom toolbar. This file
 * is the *event stream* — file-touches, tool calls, phase-contract
 * attempts — that the Phase 2 rollup needs but the cost ledger was never
 * shaped for. Keeping them separate avoids a schema migration and a
 * resume regression.
 *
 * Per ROADMAP calibration #2: this store powers RAW counters first
 * (turns, files, tool calls, duration). The project landing card may
 * also derive an *estimate* from these, but the estimate must always be
 * labelled and secondary — never the primary number.
 */

export const SessionMetricsEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session-start'),
    sessionId: z.string(),
    ts: z.number(),
  }),
  z.object({
    kind: z.literal('session-end'),
    sessionId: z.string(),
    ts: z.number(),
    /** End reason, for triage. Optional — not every shutdown carries one. */
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('turn'),
    sessionId: z.string(),
    /** `'sup'` for supervisor, `'dev'` for the developer turn loop. */
    who: z.enum(['sup', 'dev']),
    /** 1-based turn index emitted by the orchestrator. */
    turnIndex: z.number(),
    ts: z.number(),
  }),
  z.object({
    kind: z.literal('tool-call'),
    sessionId: z.string(),
    /** Agent identity — `'developer'`, `'ui-dev'`, `'security'`, `'supervisor'`, etc. */
    agent: z.string(),
    /** Tool name as emitted by Claude Code (e.g. `'Edit'`, `'Bash'`, `'Read'`). */
    tool: z.string(),
    /**
     * The file path the tool acted on, when the input carried one
     * (Edit / Write / NotebookEdit / Read). Lets `computeRollup()`
     * count *unique* file touches without re-parsing chat-log.
     */
    filePath: z.string().optional(),
    ts: z.number(),
  }),
  z.object({
    kind: z.literal('phase-contract-attempt'),
    sessionId: z.string(),
    filename: z.string(),
    contractName: z.string(),
    attemptNumber: z.number(),
    valid: z.boolean(),
    /** Operator approved an override — this attempt counts as override-bypassed, not failed. */
    override: z.boolean(),
    ts: z.number(),
  }),
  /**
   * Phase 4 telemetry — one event per `onUserPromptSubmit` drain that
   * feeds the inbox compressor. `originalTokens` is what would have
   * been injected without compression; `compressedTokens` is what
   * actually went into sup's user message. Both are estimates from
   * the char-based heuristic (`packages/core/src/orchestrator/
   * inbox-compressor.ts:estimateTokens`), not real billing tokens —
   * informational only.
   */
  z.object({
    kind: z.literal('tokens-estimated'),
    sessionId: z.string(),
    /** Recipient role of the inbox drain. Currently always `'supervisor'`. */
    role: z.string(),
    /** Number of inbox messages combined into this estimate. */
    messageCount: z.number(),
    /** Estimated tokens before compression. */
    originalTokens: z.number(),
    /** Estimated tokens after compression. */
    compressedTokens: z.number(),
    /** Marker labels preserved across compression (deduped). */
    preservedMarkers: z.array(z.string()),
    ts: z.number(),
  }),
  /**
   * Phase 7 telemetry — every classified failure surfaces here. Per
   * ROADMAP calibration #7, the rate is publicly visible: this event
   * is what feeds the bottom-toolbar failure badge + the project
   * rollup's `failureRate`. `code` matches the FailureCode union in
   * `orchestrator/failure-modes.ts`; tests guard the spelling.
   */
  z.object({
    kind: z.literal('failure'),
    sessionId: z.string(),
    /** Stable code from the failure-mode catalog. */
    code: z.string(),
    /** Optional role/agent that hit the failure (when known). */
    role: z.string().nullable().optional(),
    /** Raw error message, truncated to 1KB so the JSONL stays readable. */
    message: z.string().max(1024),
    ts: z.number(),
  }),
]);
export type SessionMetricsEvent = z.infer<typeof SessionMetricsEventSchema>;

const DEFAULT_FILENAME = 'session-metrics.jsonl';

function metricsPath(cwd: string): string {
  return process.env.SELFCLAUDE_SESSION_METRICS_PATH ?? join(cwd, '.selfclaude', DEFAULT_FILENAME);
}

/**
 * Append a single event. Failures are surfaced — the caller decides
 * whether to swallow (typical for fire-and-forget collectors) or
 * propagate (test harnesses).
 */
export async function appendSessionMetricsEvent(
  cwd: string,
  event: SessionMetricsEvent,
): Promise<void> {
  const target = metricsPath(cwd);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(event)}\n`, 'utf8');
}

/**
 * Read all events (optionally filtered by sessionId). Malformed lines
 * are skipped silently — the file is append-only and a half-written
 * tail line shouldn't break the rollup. The skip is logged at debug
 * level for triage if rollups look off.
 */
export async function readSessionMetrics(
  cwd: string,
  sessionId?: string,
): Promise<SessionMetricsEvent[]> {
  const target = metricsPath(cwd);
  if (!existsSync(target)) return [];
  const raw = await readFile(target, 'utf8');
  const out: SessionMetricsEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const result = SessionMetricsEventSchema.safeParse(parsed);
      if (!result.success) continue;
      if (sessionId && result.data.sessionId !== sessionId) continue;
      out.push(result.data);
    } catch {
      /* malformed line — skip */
    }
  }
  return out;
}

/* ───── Rollups ───── */

export interface SessionMetricsRollup {
  sessionId: string;
  /** First `session-start` ts seen (or first event ts if start was lost). */
  startedAt: number;
  /** Latest `session-end` ts; `null` while the session is still open. */
  endedAt: number | null;
  /** Wall-clock from start to end (or to "now" when caller passes one in). */
  durationMs: number;
  /** Total turns by `who`. */
  turns: { sup: number; dev: number };
  /** Tool-call counts grouped by tool name. */
  toolCalls: Record<string, number>;
  /** Tool calls grouped by agent (sup, developer, ui-dev, security, …). */
  toolCallsByAgent: Record<string, number>;
  /** Unique file paths touched (deduped across Edit / Write / NotebookEdit / Read). */
  filesTouched: number;
  /** Per-tool aggregation of *files touched* — most useful for Edit/Write. */
  filesTouchedByTool: Record<string, number>;
  /** Phase-contract aggregate. */
  phaseContract: {
    /** Total attempts across all filenames in this session. */
    totalAttempts: number;
    /**
     * First-pass rate = (filenames where attempt 1 was valid) / (total
     * filenames seen). 0 when no contract attempts. The ROADMAP
     * Phase 1 success target is ≥80% by sprint end.
     */
    firstPassRate: number;
    /** Filenames that *eventually* validated (with retry). */
    ultimateFilenames: number;
    /** Operator-approved overrides — escapes from validation. */
    overrides: number;
    /** Distinct filenames that hit any attempt. */
    distinctFilenames: number;
  };
  /** Phase 4 inbox-compressor aggregate (estimates only). */
  inboxCompression: {
    /** Number of drain events recorded for this session. */
    drainEvents: number;
    /** Estimated tokens that would have been injected without compression. */
    estimatedOriginalTokens: number;
    /** Estimated tokens actually injected after compression. */
    estimatedCompressedTokens: number;
    /** estimatedOriginalTokens − estimatedCompressedTokens. */
    estimatedTokensSaved: number;
    /** 0–1 ratio. 0 when no drains, otherwise compressed / original. */
    compressionRatio: number;
  };
  /**
   * Phase 7 failure aggregate. `total` is the raw count; `byCode`
   * breaks it down per `FailureCode` so the toolbar tooltip + the
   * project rollup can show which failure modes dominate. Empty
   * sessions have all zeros.
   */
  failures: {
    total: number;
    /** Map of `FailureCode` → count. Codes not seen aren't present. */
    byCode: Record<string, number>;
  };
}

export interface ProjectMetricsRollup {
  /** Distinct `sessionId`s seen in the event stream. */
  totalSessions: number;
  /** Total turns across every session. */
  totalTurns: { sup: number; dev: number };
  /** Total tool-call counts. */
  toolCalls: Record<string, number>;
  /** Distinct file paths across the whole project lifetime. */
  filesTouched: number;
  /** Project-level phase-contract aggregate. */
  phaseContract: {
    totalAttempts: number;
    firstPassRate: number;
    ultimateFilenames: number;
    overrides: number;
    distinctFilenames: number;
  };
  /** Sum of session durations (gaps between sessions are NOT counted). */
  activeDurationMs: number;
  /** Phase 7 — cumulative failure aggregate across every session. */
  failures: {
    total: number;
    byCode: Record<string, number>;
  };
}

/**
 * Compute a single-session rollup from the raw event list. Pass `nowMs`
 * to get a live duration when the session is still open.
 */
export function computeSessionRollup(
  events: SessionMetricsEvent[],
  sessionId: string,
  nowMs: number = Date.now(),
): SessionMetricsRollup {
  const filtered = events.filter((e) => e.sessionId === sessionId);
  const start = filtered.find((e) => e.kind === 'session-start');
  const end = [...filtered].reverse().find((e) => e.kind === 'session-end');
  const startedAt = start?.ts ?? filtered[0]?.ts ?? nowMs;
  const endedAt = end?.ts ?? null;
  const durationMs = (endedAt ?? nowMs) - startedAt;

  const turns = { sup: 0, dev: 0 };
  const toolCalls: Record<string, number> = {};
  const toolCallsByAgent: Record<string, number> = {};
  const filesTouchedSet = new Set<string>();
  const filesTouchedByTool: Record<string, number> = {};
  const filesTouchedByToolSet: Record<string, Set<string>> = {};

  // Phase-contract bucketing per filename.
  type FilenameAgg = { firstAttemptValid: boolean | null; everValid: boolean; attempts: number };
  const phasePerFilename = new Map<string, FilenameAgg>();
  let overrides = 0;

  // Phase 4 — inbox compression aggregate.
  let drainEvents = 0;
  let estimatedOriginalTokens = 0;
  let estimatedCompressedTokens = 0;

  // Phase 7 — failure aggregate.
  let failuresTotal = 0;
  const failuresByCode: Record<string, number> = {};

  for (const e of filtered) {
    if (e.kind === 'turn') {
      turns[e.who] += 1;
    } else if (e.kind === 'tool-call') {
      toolCalls[e.tool] = (toolCalls[e.tool] ?? 0) + 1;
      toolCallsByAgent[e.agent] = (toolCallsByAgent[e.agent] ?? 0) + 1;
      if (e.filePath) {
        filesTouchedSet.add(e.filePath);
        const bucket = filesTouchedByToolSet[e.tool] ?? new Set<string>();
        bucket.add(e.filePath);
        filesTouchedByToolSet[e.tool] = bucket;
      }
    } else if (e.kind === 'phase-contract-attempt') {
      let agg = phasePerFilename.get(e.filename);
      if (!agg) {
        agg = { firstAttemptValid: null, everValid: false, attempts: 0 };
        phasePerFilename.set(e.filename, agg);
      }
      agg.attempts += 1;
      if (agg.firstAttemptValid === null) agg.firstAttemptValid = e.valid;
      if (e.valid || e.override) agg.everValid = true;
      if (e.override) overrides += 1;
    } else if (e.kind === 'tokens-estimated') {
      drainEvents += 1;
      estimatedOriginalTokens += e.originalTokens;
      estimatedCompressedTokens += e.compressedTokens;
    } else if (e.kind === 'failure') {
      failuresTotal += 1;
      failuresByCode[e.code] = (failuresByCode[e.code] ?? 0) + 1;
    }
  }

  for (const [tool, set] of Object.entries(filesTouchedByToolSet)) {
    filesTouchedByTool[tool] = set.size;
  }

  let totalAttempts = 0;
  let firstPasses = 0;
  let ultimate = 0;
  for (const agg of phasePerFilename.values()) {
    totalAttempts += agg.attempts;
    if (agg.firstAttemptValid === true) firstPasses += 1;
    if (agg.everValid) ultimate += 1;
  }
  const distinctFilenames = phasePerFilename.size;

  return {
    sessionId,
    startedAt,
    endedAt,
    durationMs,
    turns,
    toolCalls,
    toolCallsByAgent,
    filesTouched: filesTouchedSet.size,
    filesTouchedByTool,
    phaseContract: {
      totalAttempts,
      firstPassRate: distinctFilenames === 0 ? 0 : firstPasses / distinctFilenames,
      ultimateFilenames: ultimate,
      overrides,
      distinctFilenames,
    },
    inboxCompression: {
      drainEvents,
      estimatedOriginalTokens,
      estimatedCompressedTokens,
      estimatedTokensSaved: estimatedOriginalTokens - estimatedCompressedTokens,
      compressionRatio:
        estimatedOriginalTokens === 0
          ? 0
          : estimatedCompressedTokens / estimatedOriginalTokens,
    },
    failures: {
      total: failuresTotal,
      byCode: failuresByCode,
    },
  };
}

/**
 * Compute the project-wide rollup across every session in the event
 * stream. Used by the home-page project card to show "you've worked
 * X turns / touched Y files in this project total."
 */
export function computeProjectRollup(events: SessionMetricsEvent[]): ProjectMetricsRollup {
  const sessionIds = new Set<string>();
  const totalTurns = { sup: 0, dev: 0 };
  const toolCalls: Record<string, number> = {};
  const filesTouchedSet = new Set<string>();

  type FilenameAgg = { firstAttemptValid: boolean | null; everValid: boolean; attempts: number };
  const phasePerFilename = new Map<string, FilenameAgg>();
  let overrides = 0;

  // Phase 7 — failure aggregate (project-level).
  let failuresTotal = 0;
  const failuresByCode: Record<string, number> = {};

  // Per-session start/end pairing for active duration.
  const startsBySession = new Map<string, number>();
  const endsBySession = new Map<string, number>();
  for (const e of events) {
    sessionIds.add(e.sessionId);
    if (e.kind === 'turn') {
      totalTurns[e.who] += 1;
    } else if (e.kind === 'tool-call') {
      toolCalls[e.tool] = (toolCalls[e.tool] ?? 0) + 1;
      if (e.filePath) filesTouchedSet.add(e.filePath);
    } else if (e.kind === 'phase-contract-attempt') {
      let agg = phasePerFilename.get(e.filename);
      if (!agg) {
        agg = { firstAttemptValid: null, everValid: false, attempts: 0 };
        phasePerFilename.set(e.filename, agg);
      }
      agg.attempts += 1;
      if (agg.firstAttemptValid === null) agg.firstAttemptValid = e.valid;
      if (e.valid || e.override) agg.everValid = true;
      if (e.override) overrides += 1;
    } else if (e.kind === 'session-start') {
      // Earliest start wins (a session-id should only have one).
      if (!startsBySession.has(e.sessionId)) startsBySession.set(e.sessionId, e.ts);
    } else if (e.kind === 'session-end') {
      // Latest end wins.
      const prev = endsBySession.get(e.sessionId);
      if (prev === undefined || e.ts > prev) endsBySession.set(e.sessionId, e.ts);
    } else if (e.kind === 'failure') {
      failuresTotal += 1;
      failuresByCode[e.code] = (failuresByCode[e.code] ?? 0) + 1;
    }
  }

  let activeDurationMs = 0;
  for (const [sid, startTs] of startsBySession.entries()) {
    const endTs = endsBySession.get(sid);
    if (endTs !== undefined) activeDurationMs += endTs - startTs;
  }

  let totalAttempts = 0;
  let firstPasses = 0;
  let ultimate = 0;
  for (const agg of phasePerFilename.values()) {
    totalAttempts += agg.attempts;
    if (agg.firstAttemptValid === true) firstPasses += 1;
    if (agg.everValid) ultimate += 1;
  }
  const distinctFilenames = phasePerFilename.size;

  return {
    totalSessions: sessionIds.size,
    totalTurns,
    toolCalls,
    filesTouched: filesTouchedSet.size,
    phaseContract: {
      totalAttempts,
      firstPassRate: distinctFilenames === 0 ? 0 : firstPasses / distinctFilenames,
      ultimateFilenames: ultimate,
      overrides,
      distinctFilenames,
    },
    activeDurationMs,
    failures: {
      total: failuresTotal,
      byCode: failuresByCode,
    },
  };
}
