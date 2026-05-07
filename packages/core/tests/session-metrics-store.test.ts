import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSessionMetricsEvent,
  computeProjectRollup,
  computeSessionRollup,
  readSessionMetrics,
  type SessionMetricsEvent,
} from '../src/project/session-metrics-store.js';

/**
 * Phase 2 telemetry store unit tests. The store is JSONL append-only;
 * the rollup math is what the UI surfaces and what the phase-1
 * first-pass-rate measurement depends on. Both directions are tested.
 *
 * Each test wraps `withFreshStore` so persistence is sandboxed via
 * SELFCLAUDE_SESSION_METRICS_PATH and cleaned up afterwards.
 */

async function withFreshStore(
  fn: (cwd: string, file: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'sc-metrics-'));
  const file = join(cwd, '.selfclaude', 'session-metrics.jsonl');
  const prev = process.env.SELFCLAUDE_SESSION_METRICS_PATH;
  process.env.SELFCLAUDE_SESSION_METRICS_PATH = file;
  try {
    await fn(cwd, file);
  } finally {
    if (prev === undefined) delete process.env.SELFCLAUDE_SESSION_METRICS_PATH;
    else process.env.SELFCLAUDE_SESSION_METRICS_PATH = prev;
    await rm(cwd, { recursive: true, force: true });
  }
}

test('readSessionMetrics on empty store returns empty array', async () => {
  await withFreshStore(async (cwd) => {
    assert.deepEqual(await readSessionMetrics(cwd), []);
  });
});

test('append + read round-trips a single event', async () => {
  await withFreshStore(async (cwd) => {
    const event: SessionMetricsEvent = {
      kind: 'session-start',
      sessionId: 's1',
      ts: 1000,
    };
    await appendSessionMetricsEvent(cwd, event);
    const back = await readSessionMetrics(cwd);
    assert.deepEqual(back, [event]);
  });
});

test('readSessionMetrics filters by sessionId', async () => {
  await withFreshStore(async (cwd) => {
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 'a', ts: 1 });
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 'b', ts: 2 });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 'a',
      who: 'sup',
      turnIndex: 1,
      ts: 3,
    });
    const onlyA = await readSessionMetrics(cwd, 'a');
    assert.equal(onlyA.length, 2);
    assert.ok(onlyA.every((e) => e.sessionId === 'a'));
  });
});

test('readSessionMetrics tolerates malformed lines', async () => {
  await withFreshStore(async (cwd, file) => {
    // Manually craft a file that mixes valid + garbage lines.
    const valid: SessionMetricsEvent = {
      kind: 'session-start',
      sessionId: 'x',
      ts: 1,
    };
    const lines = [
      JSON.stringify(valid),
      '{not json',
      '',
      JSON.stringify({ kind: 'unknown-kind', sessionId: 'y', ts: 2 }),
      JSON.stringify({ kind: 'session-end', sessionId: 'x', ts: 99 }),
    ];
    // Reach into store via env-var override → write directly.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, '.selfclaude'), { recursive: true });
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
    const back = await readSessionMetrics(cwd);
    // Garbage + unknown-kind dropped; two valid events survive.
    assert.equal(back.length, 2);
    assert.equal(back[0]!.kind, 'session-start');
    assert.equal(back[1]!.kind, 'session-end');
  });
});

test('computeSessionRollup: turns counted per role', async () => {
  await withFreshStore(async (cwd) => {
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 's', ts: 0 });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 's',
      who: 'sup',
      turnIndex: 1,
      ts: 1,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 's',
      who: 'sup',
      turnIndex: 2,
      ts: 2,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 's',
      who: 'dev',
      turnIndex: 1,
      ts: 3,
    });
    const events = await readSessionMetrics(cwd);
    const r = computeSessionRollup(events, 's', 100);
    assert.deepEqual(r.turns, { sup: 2, dev: 1 });
  });
});

test('computeSessionRollup: tool calls counted by tool + agent + file dedup', async () => {
  await withFreshStore(async (cwd) => {
    // No default filePath — each call sets it explicitly. Default
    // would leak into the Bash test case (no path) and inflate the
    // unique-file count.
    const ev = (over: Partial<Extract<SessionMetricsEvent, { kind: 'tool-call' }>>): SessionMetricsEvent => ({
      kind: 'tool-call',
      sessionId: 's',
      agent: 'developer',
      tool: 'Edit',
      ts: 1,
      ...over,
    });
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 's', ts: 0 });
    await appendSessionMetricsEvent(cwd, ev({ tool: 'Edit', filePath: '/a.ts' }));
    await appendSessionMetricsEvent(cwd, ev({ tool: 'Edit', filePath: '/a.ts' })); // same file
    await appendSessionMetricsEvent(cwd, ev({ tool: 'Write', filePath: '/b.ts' }));
    await appendSessionMetricsEvent(cwd, ev({ tool: 'Bash' })); // no filePath
    await appendSessionMetricsEvent(cwd, ev({ agent: 'security', tool: 'Read', filePath: '/c.ts' }));
    const events = await readSessionMetrics(cwd);
    const r = computeSessionRollup(events, 's', 100);
    assert.deepEqual(r.toolCalls, { Edit: 2, Write: 1, Bash: 1, Read: 1 });
    assert.deepEqual(r.toolCallsByAgent, { developer: 4, security: 1 });
    // /a.ts dedupes, so unique files = 3 (a, b, c).
    assert.equal(r.filesTouched, 3);
    // Per-tool unique-file counts.
    assert.equal(r.filesTouchedByTool['Edit'], 1);
    assert.equal(r.filesTouchedByTool['Write'], 1);
    assert.equal(r.filesTouchedByTool['Read'], 1);
  });
});

test('computeSessionRollup: phase-contract first-pass rate', async () => {
  await withFreshStore(async (cwd) => {
    const attempt = (
      over: Partial<Extract<SessionMetricsEvent, { kind: 'phase-contract-attempt' }>>,
    ): SessionMetricsEvent => ({
      kind: 'phase-contract-attempt',
      sessionId: 's',
      filename: '01-foundation.md',
      contractName: 'execution-phase-doc',
      attemptNumber: 1,
      valid: false,
      override: false,
      ts: 1,
      ...over,
    });
    // File 01: valid on attempt 1 (first-pass).
    await appendSessionMetricsEvent(cwd, attempt({ filename: '01-foo.md', valid: true }));
    // File 02: invalid on attempt 1, valid on attempt 2 (ultimate-pass, NOT first-pass).
    await appendSessionMetricsEvent(cwd, attempt({ filename: '02-bar.md', valid: false }));
    await appendSessionMetricsEvent(
      cwd,
      attempt({ filename: '02-bar.md', attemptNumber: 2, valid: true }),
    );
    // File 03: never validates.
    await appendSessionMetricsEvent(cwd, attempt({ filename: '03-baz.md', valid: false }));
    await appendSessionMetricsEvent(
      cwd,
      attempt({ filename: '03-baz.md', attemptNumber: 2, valid: false }),
    );
    const events = await readSessionMetrics(cwd);
    const r = computeSessionRollup(events, 's', 100);
    assert.equal(r.phaseContract.distinctFilenames, 3);
    assert.equal(r.phaseContract.totalAttempts, 5);
    // First-pass = 1 of 3 = 0.333...
    assert.ok(Math.abs(r.phaseContract.firstPassRate - 1 / 3) < 1e-9);
    // Ultimate-pass: file 01 + file 02 = 2.
    assert.equal(r.phaseContract.ultimateFilenames, 2);
    assert.equal(r.phaseContract.overrides, 0);
  });
});

test('computeSessionRollup: override counted, marks ultimate-pass', async () => {
  await withFreshStore(async (cwd) => {
    await appendSessionMetricsEvent(cwd, {
      kind: 'phase-contract-attempt',
      sessionId: 's',
      filename: '01-foo.md',
      contractName: 'execution-phase-doc',
      attemptNumber: 1,
      valid: false,
      override: false,
      ts: 1,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'phase-contract-attempt',
      sessionId: 's',
      filename: '01-foo.md',
      contractName: 'execution-phase-doc',
      attemptNumber: 2,
      valid: false,
      override: true,
      ts: 2,
    });
    const events = await readSessionMetrics(cwd);
    const r = computeSessionRollup(events, 's', 100);
    assert.equal(r.phaseContract.overrides, 1);
    // Override counts as ultimate-pass (the doc was accepted).
    assert.equal(r.phaseContract.ultimateFilenames, 1);
    // First attempt was invalid → first-pass = 0.
    assert.equal(r.phaseContract.firstPassRate, 0);
  });
});

test('computeSessionRollup: duration uses end ts when present, nowMs otherwise', async () => {
  await withFreshStore(async (cwd) => {
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 's', ts: 1000 });
    let events = await readSessionMetrics(cwd);
    // Open session — duration uses nowMs argument.
    let r = computeSessionRollup(events, 's', 5000);
    assert.equal(r.durationMs, 4000);
    assert.equal(r.endedAt, null);

    await appendSessionMetricsEvent(cwd, {
      kind: 'session-end',
      sessionId: 's',
      ts: 3000,
    });
    events = await readSessionMetrics(cwd);
    r = computeSessionRollup(events, 's', 5000);
    assert.equal(r.durationMs, 2000);
    assert.equal(r.endedAt, 3000);
  });
});

test('computeProjectRollup: aggregates across sessions', async () => {
  await withFreshStore(async (cwd) => {
    // Two sessions, each with a turn + a tool call.
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 'a', ts: 0 });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 'a',
      who: 'sup',
      turnIndex: 1,
      ts: 1,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'tool-call',
      sessionId: 'a',
      agent: 'developer',
      tool: 'Edit',
      filePath: '/x.ts',
      ts: 2,
    });
    await appendSessionMetricsEvent(cwd, { kind: 'session-end', sessionId: 'a', ts: 100 });

    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 'b', ts: 200 });
    await appendSessionMetricsEvent(cwd, {
      kind: 'turn',
      sessionId: 'b',
      who: 'dev',
      turnIndex: 1,
      ts: 201,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'tool-call',
      sessionId: 'b',
      agent: 'developer',
      tool: 'Edit',
      filePath: '/x.ts', // same file, same project — dedupes
      ts: 202,
    });
    await appendSessionMetricsEvent(cwd, {
      kind: 'tool-call',
      sessionId: 'b',
      agent: 'developer',
      tool: 'Write',
      filePath: '/y.ts',
      ts: 203,
    });
    await appendSessionMetricsEvent(cwd, { kind: 'session-end', sessionId: 'b', ts: 500 });

    const events = await readSessionMetrics(cwd);
    const r = computeProjectRollup(events);
    assert.equal(r.totalSessions, 2);
    assert.deepEqual(r.totalTurns, { sup: 1, dev: 1 });
    assert.deepEqual(r.toolCalls, { Edit: 2, Write: 1 });
    assert.equal(r.filesTouched, 2); // x.ts (deduped) + y.ts
    // Active duration = (100-0) + (500-200) = 400.
    assert.equal(r.activeDurationMs, 400);
  });
});

test('computeProjectRollup: handles open session (no end event yet)', async () => {
  await withFreshStore(async (cwd) => {
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 'open', ts: 0 });
    const events = await readSessionMetrics(cwd);
    const r = computeProjectRollup(events);
    assert.equal(r.totalSessions, 1);
    // No end event → activeDurationMs is 0 (we don't pin "now" at the
    // project level; per-session rollup handles live duration).
    assert.equal(r.activeDurationMs, 0);
  });
});

test('readSessionMetrics returns events in append order', async () => {
  await withFreshStore(async (cwd) => {
    const events: SessionMetricsEvent[] = [
      { kind: 'session-start', sessionId: 's', ts: 0 },
      { kind: 'turn', sessionId: 's', who: 'sup', turnIndex: 1, ts: 1 },
      { kind: 'tool-call', sessionId: 's', agent: 'developer', tool: 'Edit', ts: 2 },
      { kind: 'session-end', sessionId: 's', ts: 3 },
    ];
    for (const e of events) {
      await appendSessionMetricsEvent(cwd, e);
    }
    const back = await readSessionMetrics(cwd);
    assert.deepEqual(
      back.map((e) => e.kind),
      events.map((e) => e.kind),
    );
  });
});

test('verify file lives at the env-overridden path', async () => {
  // Sanity check the test harness: SELFCLAUDE_SESSION_METRICS_PATH
  // routes the store to a temp path. If it didn't, we'd be writing to
  // the operator's real cwd — every test would pollute it.
  await withFreshStore(async (cwd, file) => {
    await appendSessionMetricsEvent(cwd, { kind: 'session-start', sessionId: 's', ts: 0 });
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /"kind":"session-start"/);
  });
});
