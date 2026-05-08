import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  getFailureMode,
  listFailureModes,
  type FailureCode,
} from '../src/orchestrator/failure-modes.js';

/**
 * Phase 7 sprint 1 — failure-mode catalog tests. The catalog is part
 * of the storage contract; codes are stable identifiers. These tests
 * pin the codes so a future rename surfaces as a test diff, not a
 * silent dashboard regression.
 */

test('catalog covers every declared FailureCode', () => {
  // Type-level: the FailureCode union and CATALOG keys must align.
  // Runtime: every code resolves to a populated entry.
  const expected: FailureCode[] = [
    'tool-error',
    'agent-timeout',
    'context-overflow',
    'hook-validation',
    'network-error',
    'mcp-crash',
    'agent-aborted',
    'unknown',
  ];
  for (const code of expected) {
    const mode = getFailureMode(code);
    assert.equal(mode.code, code);
    assert.ok(mode.label.length > 0);
    assert.ok(mode.description.length > 0);
    assert.ok(mode.suggestedAction.length > 0);
    assert.ok(['info', 'warn', 'error'].includes(mode.severity));
  }
});

test('listFailureModes returns every entry', () => {
  const all = listFailureModes();
  assert.ok(all.length >= 8);
  // No duplicates by code.
  const codes = new Set(all.map((m) => m.code));
  assert.equal(codes.size, all.length);
});

test('classifyFailure: aborted messages → agent-aborted', () => {
  assert.equal(classifyFailure('AbortError: turn aborted'), 'agent-aborted');
  assert.equal(classifyFailure('the user aborted the request'), 'agent-aborted');
  assert.equal(classifyFailure('Aborted'), 'agent-aborted');
});

test('classifyFailure: timeout markers → agent-timeout', () => {
  assert.equal(classifyFailure('Timeout: turn exceeded 600s'), 'agent-timeout');
  assert.equal(classifyFailure('request timed out'), 'agent-timeout');
});

test('classifyFailure: context overflow markers → context-overflow', () => {
  assert.equal(
    classifyFailure('Context window overflow at 200000 tokens'),
    'context-overflow',
  );
  assert.equal(
    classifyFailure('Reached context limit; older messages dropped'),
    'context-overflow',
  );
});

test('classifyFailure: hook denial markers → hook-validation', () => {
  assert.equal(
    classifyFailure('Blocked by SelfClaude (rm -rf); hook denied'),
    'hook-validation',
  );
  assert.equal(
    classifyFailure('hook rejected: file-lock conflict'),
    'hook-validation',
  );
});

test('classifyFailure: network markers → network-error', () => {
  assert.equal(classifyFailure('ECONNREFUSED 127.0.0.1:7423'), 'network-error');
  assert.equal(classifyFailure('ENOTFOUND api.anthropic.com'), 'network-error');
  assert.equal(classifyFailure('socket hang up'), 'network-error');
  assert.equal(classifyFailure('TypeError: fetch failed'), 'network-error');
});

test('classifyFailure: MCP markers → mcp-crash', () => {
  assert.equal(classifyFailure('orchestrator returned 500: schema error'), 'mcp-crash');
  assert.equal(classifyFailure('mcp bridge offline'), 'mcp-crash');
});

test('classifyFailure: tool markers → tool-error', () => {
  assert.equal(classifyFailure('Tool Edit failed: file not found'), 'tool-error');
});

test('classifyFailure: unmatched messages → unknown', () => {
  assert.equal(classifyFailure(''), 'unknown');
  assert.equal(classifyFailure('something weird happened'), 'unknown');
});

test('classifyFailure: order priority — aborted beats timeout', () => {
  // A message that mentions both should land on the more specific
  // (and operator-initiated) bucket.
  assert.equal(classifyFailure('aborted after timeout'), 'agent-aborted');
});

test('getFailureMode: every FailureCode entry has a non-empty severity', () => {
  for (const mode of listFailureModes()) {
    assert.ok(mode.severity);
  }
});
