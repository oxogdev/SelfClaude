import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_AGENTS,
  getAgent,
  listAgents,
  loadAgentPrompt,
  type BuiltInAgentName,
} from '../src/agents/registry.js';

/**
 * Phase 8 sprint 1 — built-in registry sanity tests.
 *
 * The hard cap commitment is that v1.0 ships with **exactly 6**
 * built-in agents (supervisor + 5 spawnable specialists). These
 * tests pin the roster so a future drive-by addition surfaces in
 * the diff loud and clear, and catch silent typos in
 * systemPromptFile (every prompt file must exist + be non-empty).
 */

const EXPECTED_AGENTS: BuiltInAgentName[] = [
  'supervisor',
  'developer',
  'ui-dev',
  'security',
  'tester',
  'refactorer',
];

test('built-in registry contains exactly the expected 6 agents', () => {
  const actual = Object.keys(BUILTIN_AGENTS).sort();
  const expected = [...EXPECTED_AGENTS].sort();
  assert.deepEqual(actual, expected);
});

test('listAgents returns one entry per built-in', () => {
  const all = listAgents();
  assert.equal(all.length, EXPECTED_AGENTS.length);
});

test('every expected agent resolves via getAgent + has a populated config', () => {
  for (const name of EXPECTED_AGENTS) {
    const cfg = getAgent(name);
    assert.ok(cfg, `getAgent("${name}") must not return null`);
    if (!cfg) continue;
    assert.equal(cfg.name, name);
    assert.ok(cfg.label.length > 0, `${name}: label must not be empty`);
    assert.ok(cfg.systemPromptFile.length > 0, `${name}: systemPromptFile must be set`);
    assert.ok(cfg.description.length > 0, `${name}: description must not be empty`);
    assert.ok(
      ['cyan', 'amber', 'violet', 'rose', 'emerald', 'zinc'].includes(cfg.accent),
      `${name}: accent must be one of the supported palette values`,
    );
  }
});

test('every spawnable specialist has a loadable system prompt on disk', () => {
  for (const name of EXPECTED_AGENTS) {
    if (name === 'supervisor') continue; // sup gets loaded via its own loader
    const cfg = getAgent(name);
    if (!cfg) continue;
    const prompt = loadAgentPrompt(cfg);
    assert.ok(prompt.length > 200, `${name}: system prompt suspiciously short (${prompt.length} chars)`);
    // Each prompt should at least mention the role's identity.
    assert.match(prompt, new RegExp(name, 'i'), `${name}: prompt must reference its role name`);
  }
});

test('tester and refactorer are present and spawnable (Phase 8 hard cap)', () => {
  const tester = getAgent('tester');
  assert.ok(tester);
  assert.equal(tester?.spawnable, true);
  assert.equal(tester?.readOnly, false); // tester writes test files

  const refactorer = getAgent('refactorer');
  assert.ok(refactorer);
  assert.equal(refactorer?.spawnable, true);
  assert.equal(refactorer?.readOnly, false);
});

test('security is the only read-only spawnable specialist (regression guard)', () => {
  const readOnlyAgents = listAgents().filter((a) => a.readOnly);
  // Just security today — if a future read-only specialist lands, the
  // expected-list assertion above already catches it. This guard pins
  // the *count* so a silent flip on an existing agent is loud.
  assert.equal(readOnlyAgents.length, 1);
  assert.equal(readOnlyAgents[0]?.name, 'security');
});
