import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStuck,
  isProgressMarker,
  type StuckCheckInput,
} from '../src/orchestrator/stuck-detector.js';

/**
 * Phase 7 sprint 2B — stuck detector tests. The detector is pure,
 * so each test exercises one branch of the heuristic with a small
 * input shape. Locking the branch identifiers (`reason` codes) here
 * means a future thresholds tweak can't silently re-route an
 * existing case to a different bucket.
 */

const baseInput: StuckCheckInput = {
  nowMs: 1000 * 60 * 10, // 10 min epoch baseline
  lastProgressTs: null,
  supTurnCount: 0,
  fsmPhase: 'phase-loop',
  hasPending: false,
  busy: false,
};

test('discovery phase suppresses stuck detection', () => {
  const r = detectStuck({ ...baseInput, fsmPhase: 'discovery' });
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'in-discovery-or-docs');
});

test('docs phase suppresses stuck detection', () => {
  const r = detectStuck({ ...baseInput, fsmPhase: 'docs' });
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'in-discovery-or-docs');
});

test('pending operator input suppresses stuck detection', () => {
  const r = detectStuck({
    ...baseInput,
    hasPending: true,
    supTurnCount: 10,
    lastProgressTs: null,
  });
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'pending-operator-input');
});

test('fewer than minSupTurns turns: not stuck (warmup)', () => {
  const r = detectStuck({ ...baseInput, supTurnCount: 2 });
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'too-few-turns');
});

test('lots of turns but never a single progress marker: stuck', () => {
  // Classic failure: sup is churning but not delegating any writes.
  const r = detectStuck({
    ...baseInput,
    supTurnCount: 8,
    lastProgressTs: null,
  });
  assert.equal(r.stuck, true);
  assert.equal(r.reason, 'no-progress-yet');
});

test('recent progress (< threshold): not stuck', () => {
  const now = 1000 * 60 * 30;
  const r = detectStuck({
    ...baseInput,
    nowMs: now,
    supTurnCount: 8,
    lastProgressTs: now - 60_000 * 2, // 2 minutes ago
  });
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'recent-progress');
  assert.ok(r.minutesSinceProgress! >= 1.5 && r.minutesSinceProgress! < 3);
});

test('no progress in 6 minutes (default threshold 5): stuck', () => {
  const now = 1000 * 60 * 30;
  const r = detectStuck({
    ...baseInput,
    nowMs: now,
    supTurnCount: 8,
    lastProgressTs: now - 60_000 * 6,
  });
  assert.equal(r.stuck, true);
  assert.equal(r.reason, 'no-progress-window-exceeded');
  assert.ok(r.minutesSinceProgress! >= 5.5);
});

test('threshold respects opts.thresholdMinutes override', () => {
  const now = 1000 * 60 * 30;
  // 4 minutes since progress, threshold 2 → stuck.
  const r = detectStuck(
    {
      ...baseInput,
      nowMs: now,
      supTurnCount: 8,
      lastProgressTs: now - 60_000 * 4,
    },
    { thresholdMinutes: 2 },
  );
  assert.equal(r.stuck, true);
  assert.equal(r.reason, 'no-progress-window-exceeded');
});

test('opts.minSupTurns override raises the warmup bar', () => {
  // Default warmup is 3; with override 10, a 5-turn session never arms.
  const r = detectStuck(
    {
      ...baseInput,
      supTurnCount: 5,
      lastProgressTs: null,
    },
    { minSupTurns: 10 },
  );
  assert.equal(r.stuck, false);
  assert.equal(r.reason, 'too-few-turns');
});

test('isProgressMarker: phase-tracker mutations always count', () => {
  assert.equal(isProgressMarker('phase-item-confirmed'), true);
  assert.equal(isProgressMarker('phase-item-rejected'), true);
  assert.equal(isProgressMarker('phase-item-operator-verified'), true);
  assert.equal(isProgressMarker('phase-doc-written'), true);
  assert.equal(isProgressMarker('phase-registered'), true);
  assert.equal(isProgressMarker('verdict'), true);
  assert.equal(isProgressMarker('task-marker'), true);
});

test('isProgressMarker: file-changing tools count', () => {
  assert.equal(isProgressMarker('dev-tool-call', 'Edit'), true);
  assert.equal(isProgressMarker('dev-tool-call', 'Write'), true);
  assert.equal(isProgressMarker('dev-tool-call', 'NotebookEdit'), true);
  assert.equal(isProgressMarker('agent-tool-call', 'Write'), true);
  assert.equal(isProgressMarker('sup-tool-call', 'Edit'), true);
});

test('isProgressMarker: Read / Bash / Grep do NOT count', () => {
  assert.equal(isProgressMarker('dev-tool-call', 'Read'), false);
  assert.equal(isProgressMarker('dev-tool-call', 'Bash'), false);
  assert.equal(isProgressMarker('dev-tool-call', 'Grep'), false);
  assert.equal(isProgressMarker('dev-tool-call', 'Glob'), false);
});

test('isProgressMarker: text + thinking events do NOT count', () => {
  assert.equal(isProgressMarker('sup-message'), false);
  assert.equal(isProgressMarker('dev-text'), false);
  assert.equal(isProgressMarker('agent-text'), false);
  assert.equal(isProgressMarker('sup-thinking'), false);
});
