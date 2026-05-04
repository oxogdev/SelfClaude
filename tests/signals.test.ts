import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals } from '../src/orchestrator/signals.js';

test('extracts <<DISCOVERY_COMPLETE>> as a single signal', () => {
  const r = extractSignals('All clear.\n<<DISCOVERY_COMPLETE>>\nMoving on.');
  assert.deepEqual(r.signals, ['discovery-complete']);
  assert.equal(r.remainingText, 'All clear.\n\nMoving on.');
});

test('extracts <<READY_TO_EXECUTE>> as a single signal', () => {
  const r = extractSignals('Docs written.\n<<READY_TO_EXECUTE>>');
  assert.deepEqual(r.signals, ['ready-to-execute']);
});

test('extracts both DISCOVERY_COMPLETE and READY_TO_EXECUTE if both present', () => {
  const r = extractSignals(
    '<<DISCOVERY_COMPLETE>>\nNow docs.\n<<READY_TO_EXECUTE>>',
  );
  assert.deepEqual(new Set(r.signals), new Set(['discovery-complete', 'ready-to-execute']));
});

test('dedupes repeated tokens of same kind', () => {
  const r = extractSignals('<<READY_TO_EXECUTE>>\n<<READY_TO_EXECUTE>>\n<<READY_TO_EXECUTE>>');
  assert.deepEqual(r.signals, ['ready-to-execute']);
});

test('strips signal tokens out of remaining text', () => {
  const r = extractSignals('Header\n<<READY_TO_EXECUTE>>\nFooter');
  assert.equal(r.remainingText, 'Header\n\nFooter');
});

test('returns no signals when none present', () => {
  const r = extractSignals('Just normal supervisor chat.');
  assert.deepEqual(r.signals, []);
  assert.equal(r.remainingText, 'Just normal supervisor chat.');
});

test('extracts <<PHASE_COMPLETE>>', () => {
  const r = extractSignals('Phase 1 done.\n<<PHASE_COMPLETE>>');
  assert.deepEqual(r.signals, ['phase-complete']);
});

test('inline-mid-sentence signals are still extracted (lenient)', () => {
  // The supervisor system prompt asks for signals on their own lines, but the
  // parser is lenient — finds the token wherever it sits.
  const r = extractSignals('We are <<READY_TO_EXECUTE>> now.');
  assert.deepEqual(r.signals, ['ready-to-execute']);
  assert.equal(r.remainingText, 'We are  now.');
});
