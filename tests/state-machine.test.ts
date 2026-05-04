import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IllegalTransitionError,
  initialState,
  transition,
} from '../src/orchestrator/state-machine.js';

test('initial state is idle in discovery phase', () => {
  const s = initialState();
  assert.equal(s.tag, 'idle');
  if (s.tag === 'idle') assert.equal(s.phase, 'discovery');
});

test('idle → sup-running on sup-turn-start', () => {
  const next = transition(initialState(), { kind: 'sup-turn-start' });
  assert.equal(next.tag, 'sup-running');
});

test('sup-running → idle on sup-turn-end', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'sup-turn-end' });
  assert.equal(s.tag, 'idle');
});

test('sup-running → awaiting-user on ask-user', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'ask-user', questionId: 'q1' });
  assert.equal(s.tag, 'awaiting-user');
  if (s.tag === 'awaiting-user') assert.equal(s.questionId, 'q1');
});

test('awaiting-user → sup-running on user-replied with matching id', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'ask-user', questionId: 'q1' });
  s = transition(s, { kind: 'user-replied', questionId: 'q1' });
  assert.equal(s.tag, 'sup-running');
});

test('awaiting-user throws on user-replied with mismatched id', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'ask-user', questionId: 'q1' });
  assert.throws(
    () => transition(s, { kind: 'user-replied', questionId: 'wrong' }),
    IllegalTransitionError,
  );
});

test('dev-running → awaiting-approval on request-approval', () => {
  let s = transition(initialState(), { kind: 'dev-turn-start' });
  s = transition(s, { kind: 'request-approval', approvalId: 'a1' });
  assert.equal(s.tag, 'awaiting-approval');
  if (s.tag === 'awaiting-approval') assert.equal(s.approvalId, 'a1');
});

test('awaiting-approval → idle on matching approval-decided', () => {
  let s = transition(initialState(), { kind: 'dev-turn-start' });
  s = transition(s, { kind: 'request-approval', approvalId: 'a1' });
  s = transition(s, { kind: 'approval-decided', approvalId: 'a1' });
  assert.equal(s.tag, 'idle');
});

test('pause from active state preserves previous tag', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'pause' });
  assert.equal(s.tag, 'paused');
  if (s.tag === 'paused') assert.equal(s.previous, 'sup-running');
});

test('resume from paused returns to idle', () => {
  let s = transition(initialState(), { kind: 'pause' });
  s = transition(s, { kind: 'resume' });
  assert.equal(s.tag, 'idle');
});

test('shutdown is terminal — any further transition throws', () => {
  const s = transition(initialState(), { kind: 'shutdown' });
  assert.equal(s.tag, 'shutdown');
  assert.throws(
    () => transition(s, { kind: 'sup-turn-start' }),
    IllegalTransitionError,
  );
});

test('set-phase preserves tag and updates phase', () => {
  let s = transition(initialState(), { kind: 'sup-turn-start' });
  s = transition(s, { kind: 'set-phase', phase: 'phase-loop' });
  assert.equal(s.tag, 'sup-running');
  if (s.tag === 'sup-running') assert.equal(s.phase, 'phase-loop');
});

test('idempotent pause does not nest', () => {
  let s = transition(initialState(), { kind: 'pause' });
  const sBefore = s;
  s = transition(s, { kind: 'pause' });
  assert.deepEqual(s, sBefore);
});
