import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_CONTRACT,
  OVERVIEW_CONTRACT,
  buildOverrideRequiredMessage,
  buildRetryMessage,
  pickContractForFilename,
  validatePhaseDoc,
} from '../src/orchestrator/phase-contracts.js';

/**
 * Phase-contract unit tests. The contracts are the determinism
 * foundation (Phase 1 of ROADMAP.md): they specify the structural
 * shape every phase doc must follow, validate at the MCP boundary,
 * and feed sup a worked exemplar on failure so the retry actually
 * has a pattern to copy from.
 *
 * The exemplars themselves are valid by construction — the very
 * first test asserts that, since a broken exemplar would teach the
 * model the wrong pattern (and we'd have a deterministic violator
 * shipped to every project).
 */

test('bundled exemplars satisfy their own contracts', () => {
  const overviewResult = validatePhaseDoc(OVERVIEW_CONTRACT.exemplar, OVERVIEW_CONTRACT);
  assert.equal(
    overviewResult.valid,
    true,
    `OVERVIEW_CONTRACT exemplar must self-validate. Violations: ${overviewResult.violations
      .map((v) => v.message)
      .join('; ')}`,
  );

  const execResult = validatePhaseDoc(EXECUTION_CONTRACT.exemplar, EXECUTION_CONTRACT);
  assert.equal(
    execResult.valid,
    true,
    `EXECUTION_CONTRACT exemplar must self-validate. Violations: ${execResult.violations
      .map((v) => v.message)
      .join('; ')}`,
  );
});

test('pickContractForFilename routes 00-* to overview contract', () => {
  assert.equal(pickContractForFilename('00-overview.md')?.name, OVERVIEW_CONTRACT.name);
  assert.equal(pickContractForFilename('00-foo.md')?.name, OVERVIEW_CONTRACT.name);
});

test('pickContractForFilename routes 01-..09- to execution contract', () => {
  assert.equal(pickContractForFilename('01-foundation.md')?.name, EXECUTION_CONTRACT.name);
  assert.equal(pickContractForFilename('07-billing.md')?.name, EXECUTION_CONTRACT.name);
  assert.equal(pickContractForFilename('99-cleanup.md')?.name, EXECUTION_CONTRACT.name);
});

test('pickContractForFilename returns null for non-numeric prefixes', () => {
  // Free-form filenames bypass validation entirely — sup may write
  // ad-hoc docs (e.g. memo.md) without contract enforcement.
  assert.equal(pickContractForFilename('memo.md'), null);
  assert.equal(pickContractForFilename('readme-extra.md'), null);
});

test('validatePhaseDoc detects every missing required section', () => {
  const empty = '# Phase 01\n\nNo headings underneath.\n';
  const result = validatePhaseDoc(empty, EXECUTION_CONTRACT);
  assert.equal(result.valid, false);
  // Every required section in EXECUTION_CONTRACT should be flagged.
  const requiredIds = EXECUTION_CONTRACT.sections.filter((s) => s.required).map((s) => s.id);
  for (const id of requiredIds) {
    assert.ok(
      result.sectionsMissing.includes(id),
      `expected sectionsMissing to include "${id}", got ${result.sectionsMissing.join(', ')}`,
    );
  }
});

test('validatePhaseDoc enforces minBullets', () => {
  // Goal/scope/criteria/verification all present but Scope has only 1 bullet (need 3).
  const body = `# Phase 01 — Foo

## Goal

Stand up the X service so subsequent feature phases have a stable base for everything that follows after.

## Scope

- One thing only

## Success Criteria

- Server boots
- Tests pass
- Health endpoint returns 200

## Verification

After dev reports done, sup smoke-tests by running pnpm dev and curling /health to confirm.

## Out of Scope

- Database (deferred)
`;
  const result = validatePhaseDoc(body, EXECUTION_CONTRACT);
  assert.equal(result.valid, false);
  const scopeViolation = result.violations.find(
    (v) => v.sectionId === 'scope' && v.rule === 'too-few-bullets',
  );
  assert.ok(scopeViolation, 'expected too-few-bullets on scope section');
});

test('validatePhaseDoc enforces minWords', () => {
  // All sections present + bullets, but Goal is too short.
  const body = `# Phase 01 — Foo

## Goal

Tiny.

## Scope

- A
- B
- C

## Success Criteria

- X
- Y
- Z

## Verification

Sup smoke-tests by running the dev server and verifying the endpoint responds correctly.

## Out of Scope

- Other stuff
`;
  const result = validatePhaseDoc(body, EXECUTION_CONTRACT);
  assert.equal(result.valid, false);
  const goalViolation = result.violations.find(
    (v) => v.sectionId === 'goal' && v.rule === 'too-few-words',
  );
  assert.ok(goalViolation, 'expected too-few-words on goal section');
});

test('validatePhaseDoc heading match is lenient (case + suffix tolerant)', () => {
  // Sup may write "## goal" or "## Goal: Foundation" — both match contract title "Goal".
  const body = `# Phase 01

## goal

Stand up the X service so subsequent feature phases have a stable base for everything else that follows after this initial scaffolding lands and is verified working.

## scope

- A
- B
- C

## SUCCESS CRITERIA

- Server boots
- Tests pass
- Health endpoint returns 200

## Verification — How we will know

Sup smoke-tests by running pnpm dev locally and curling /health to confirm the endpoint actually returns the expected response payload.

## Out of Scope

- Other stuff
`;
  const result = validatePhaseDoc(body, EXECUTION_CONTRACT);
  assert.equal(
    result.valid,
    true,
    `expected lenient heading match, got violations: ${result.violations.map((v) => v.message).join('; ')}`,
  );
});

test('validatePhaseDoc heading match rejects different word ("Goals" != "Goal")', () => {
  // Plurals / different words must NOT match — that's a real
  // structural difference sup needs to fix.
  const body = `# Phase 01

## Goals

Plural — different word, must not match contract "Goal".

## Scope

- A
- B
- C

## Success Criteria

- Server boots
- Tests pass
- Health endpoint returns 200

## Verification

Sup smoke-tests by running pnpm dev and curling /health to confirm responses are correct.

## Out of Scope

- Other stuff
`;
  const result = validatePhaseDoc(body, EXECUTION_CONTRACT);
  assert.equal(result.valid, false);
  assert.ok(result.sectionsMissing.includes('goal'));
});

test('buildRetryMessage includes the exemplar so sup has a pattern to copy', () => {
  const result = validatePhaseDoc('# Phase 01\n\nNothing.', EXECUTION_CONTRACT);
  const msg = buildRetryMessage(result, EXECUTION_CONTRACT, 1);
  assert.match(msg, /attempt 1 of 3/, 'expected attempt counter in header');
  assert.match(msg, /Issues:/, 'expected issue list header');
  assert.match(msg, /Worked exemplar/i, 'expected exemplar header');
  // Random fragment from the exemplar — proves the body is included.
  assert.match(msg, /Stand up the Fastify HTTP service/, 'expected exemplar body included');
});

test('buildOverrideRequiredMessage tells sup to stop and ask the operator', () => {
  const result = validatePhaseDoc('# Phase 01\n\nNothing.', EXECUTION_CONTRACT);
  const msg = buildOverrideRequiredMessage(result, EXECUTION_CONTRACT, 4);
  assert.match(msg, /Stop retrying/i, 'expected explicit stop instruction');
  assert.match(msg, /ask_user/i, 'expected ask_user instruction');
  assert.match(msg, /override: true/, 'expected override flag mention');
});

test('valid doc → empty violations + every required section reported as found', () => {
  const result = validatePhaseDoc(EXECUTION_CONTRACT.exemplar, EXECUTION_CONTRACT);
  assert.equal(result.valid, true);
  assert.equal(result.violations.length, 0);
  // All required sections should be in sectionsFound
  const requiredIds = EXECUTION_CONTRACT.sections.filter((s) => s.required).map((s) => s.id);
  for (const id of requiredIds) {
    assert.ok(result.sectionsFound.includes(id), `expected sectionsFound to include "${id}"`);
  }
});
