import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compressInboxMessage,
  estimateTokens,
} from '../src/orchestrator/inbox-compressor.js';

/**
 * Phase 4 inbox-compressor unit tests. The compressor sits on the
 * critical path of every supervisor turn after a developer report —
 * a regression that drops a verdict or a phase-complete signal would
 * silently corrupt orchestrator state. Each test pins one invariant.
 */

const PRESERVED_VERDICT =
  '<VERDICT id="3">All admin endpoints must run behind the operator-only auth middleware. Decided after a security audit found IDOR risk on /api/admin/users.</VERDICT>';

const NARRATIVE_FILLER = (() => {
  // Filler paragraph repeated to push the body well past the
  // compression threshold without containing any preserved markers.
  const para =
    'I read every file under src/server/, identified the auth boundary, ' +
    'audited the middleware order and confirmed no early-return on ' +
    'unauthenticated requests. The session middleware is correctly ' +
    'placed before any route handler, but the admin/users endpoint ' +
    'previously bypassed it through a typo in the route definition. ' +
    'I have already corrected the typo and added a regression test that ' +
    'asserts a 401 response for anonymous requests to /api/admin/users.';
  return Array.from({ length: 30 }, () => para).join('\n\n');
})();

test('compressInboxMessage: bypasses bodies below the threshold', () => {
  const body = 'Short developer report. All tests pass.';
  const r = compressInboxMessage(body);
  assert.equal(r.bypassed, true);
  assert.equal(r.body, body);
  assert.equal(r.originalBytes, body.length);
  assert.equal(r.compressedBytes, body.length);
  assert.equal(r.tokensSaved, 0);
});

test('compressInboxMessage: shrinks long pure-narrative bodies', () => {
  const r = compressInboxMessage(NARRATIVE_FILLER);
  assert.equal(r.bypassed, false);
  assert.ok(
    r.compressedBytes < r.originalBytes,
    `expected compression; got ${r.compressedBytes} >= ${r.originalBytes}`,
  );
  assert.ok(r.tokensSaved > 0, 'tokensSaved must be positive when compression happens');
  assert.match(r.body, /\[…\d+ chars elided/, 'expected elision placeholder');
});

test('compressInboxMessage: preserves a <VERDICT> block verbatim across compression', () => {
  const body = `${NARRATIVE_FILLER}\n\n${PRESERVED_VERDICT}\n\n${NARRATIVE_FILLER}`;
  const r = compressInboxMessage(body);
  assert.equal(r.bypassed, false);
  assert.ok(
    r.body.includes(PRESERVED_VERDICT),
    'compressed body must still include the full verdict text',
  );
  assert.ok(r.preservedMarkers.includes('verdict'));
});

test('compressInboxMessage: preserves <<PHASE_COMPLETE>> when present in long body', () => {
  const body = `${NARRATIVE_FILLER}\n\n<<PHASE_COMPLETE>>\n\n${NARRATIVE_FILLER}`;
  const r = compressInboxMessage(body);
  assert.ok(r.body.includes('<<PHASE_COMPLETE>>'));
  assert.ok(r.preservedMarkers.includes('phase-complete'));
});

test('compressInboxMessage: preserves <<DISCOVERY_COMPLETE>> and <<READY_TO_EXECUTE>>', () => {
  const body =
    `${NARRATIVE_FILLER}\n<<DISCOVERY_COMPLETE>>\n${NARRATIVE_FILLER}\n<<READY_TO_EXECUTE>>\n${NARRATIVE_FILLER}`;
  const r = compressInboxMessage(body);
  assert.ok(r.body.includes('<<DISCOVERY_COMPLETE>>'));
  assert.ok(r.body.includes('<<READY_TO_EXECUTE>>'));
  assert.ok(r.preservedMarkers.includes('discovery-complete'));
  assert.ok(r.preservedMarkers.includes('ready-to-execute'));
});

test('compressInboxMessage: preserves multiple verdicts in one body', () => {
  const v1 = '<VERDICT id="1">Use Postgres, not MySQL.</VERDICT>';
  const v2 = '<VERDICT id="2">Sessions must be HttpOnly + SameSite=strict.</VERDICT>';
  const body = `${NARRATIVE_FILLER}\n${v1}\n${NARRATIVE_FILLER}\n${v2}\n${NARRATIVE_FILLER}`;
  const r = compressInboxMessage(body);
  assert.ok(r.body.includes(v1));
  assert.ok(r.body.includes(v2));
});

test('compressInboxMessage: lead and tail content is preserved', () => {
  const lead = 'LEAD_MARKER_xyz: this opening sentence must survive. ';
  const tail = ' TAIL_MARKER_abc: this closing sentence must also survive.';
  const body = `${lead}${NARRATIVE_FILLER}${tail}`;
  const r = compressInboxMessage(body);
  assert.ok(r.body.includes('LEAD_MARKER_xyz'), 'lead must survive');
  assert.ok(r.body.includes('TAIL_MARKER_abc'), 'tail must survive');
});

test('compressInboxMessage: deterministic — same input → same output', () => {
  const body = `${NARRATIVE_FILLER}\n${PRESERVED_VERDICT}\n${NARRATIVE_FILLER}`;
  const a = compressInboxMessage(body);
  const b = compressInboxMessage(body);
  assert.equal(a.body, b.body);
  assert.equal(a.compressedBytes, b.compressedBytes);
  assert.deepEqual(a.preservedMarkers, b.preservedMarkers);
});

test('compressInboxMessage: never expands — falls back to original if compression overshoots', () => {
  // Body where the lead+tail+markers already exceed the body length.
  // Compressor should bail to bypassed (or at minimum output ≤ input).
  const body = `head ${PRESERVED_VERDICT} tail`;
  const r = compressInboxMessage(body, { minBytesToCompress: 1 });
  assert.ok(
    r.compressedBytes <= r.originalBytes,
    `compressor must never expand: got ${r.compressedBytes} > ${r.originalBytes}`,
  );
});

test('compressInboxMessage: handles unmatched <VERDICT> open tag without losing content', () => {
  // Truncated tag at end-of-body — compressor preserves from open
  // to body end so the marker isn't silently dropped.
  const truncated = `${NARRATIVE_FILLER}\n<VERDICT id="9">Cliff-hanger, no close tag`;
  const r = compressInboxMessage(truncated);
  assert.ok(
    r.body.includes('<VERDICT id="9">'),
    'unmatched open marker must still appear in output',
  );
});

test('estimateTokens: scales linearly-ish with input length', () => {
  // Char-based heuristic: 4 chars ≈ 1 token. Not exact but stable.
  const short = 'hi'; // 2 chars → 1 token (rounded up)
  const longer = 'a'.repeat(400); // 400 chars → 100 tokens
  assert.equal(estimateTokens(short), 1);
  assert.equal(estimateTokens(longer), 100);
});

test('estimateTokens: empty input returns 0', () => {
  assert.equal(estimateTokens(''), 0);
});

test('compressInboxMessage: tokensSaved is consistent with originalBytes - compressedBytes', () => {
  const body = `${NARRATIVE_FILLER}\n${PRESERVED_VERDICT}\n${NARRATIVE_FILLER}`;
  const r = compressInboxMessage(body);
  if (!r.bypassed) {
    const computed = estimateTokens(body) - estimateTokens(r.body);
    assert.equal(r.tokensSaved, computed);
  }
});
