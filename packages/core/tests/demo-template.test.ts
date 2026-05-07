import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEMO_ARTIFACT_FILENAME,
  DEMO_PROMPT,
  DEMO_ROOT_DIRNAME,
  isDemoWorkspace,
  newDemoWorkspaceDir,
} from '../src/server/demo-template.js';

/**
 * Phase 3 demo-template unit tests. The module is small and pure —
 * the brittle bits are path composition (must always live under the
 * demos root) and the workspace predicate (must reject paths that
 * happen to *contain* the substring but aren't really demos).
 */

test('newDemoWorkspaceDir returns a path under ~/.selfclaude/demos/', () => {
  const dir = newDemoWorkspaceDir(new Date('2026-05-07T10:00:00Z'));
  const expectedRoot = join(homedir(), '.selfclaude', DEMO_ROOT_DIRNAME);
  assert.ok(
    dir.startsWith(expectedRoot),
    `expected dir under ${expectedRoot}, got ${dir}`,
  );
});

test('newDemoWorkspaceDir produces a slug-safe filename', () => {
  const dir = newDemoWorkspaceDir(new Date('2026-05-07T10:00:00Z'));
  // No colons or dots in the basename — those break on Windows / leak
  // into URLs awkwardly.
  const base = dir.split('/').pop() ?? '';
  assert.ok(base.startsWith('demo-'), 'basename should start with "demo-"');
  assert.equal(base.includes(':'), false, 'no colons in basename');
});

test('newDemoWorkspaceDir is unique per timestamp', () => {
  const a = newDemoWorkspaceDir(new Date('2026-05-07T10:00:00Z'));
  const b = newDemoWorkspaceDir(new Date('2026-05-07T10:00:00.500Z'));
  assert.notEqual(a, b, 'different timestamps must produce different dirs');
});

test('isDemoWorkspace recognises a real demo path', () => {
  const dir = newDemoWorkspaceDir(new Date());
  assert.equal(isDemoWorkspace(dir), true);
});

test('isDemoWorkspace rejects look-alike paths outside the demos root', () => {
  // A user's project that happens to be named "demos" should NOT be
  // treated as a SelfClaude demo. Boundary is "<home>/.selfclaude/demos/",
  // not just "demos".
  assert.equal(isDemoWorkspace('/Users/somebody/projects/demos/foo'), false);
  assert.equal(isDemoWorkspace('/tmp/whatever'), false);
  assert.equal(isDemoWorkspace(''), false);
});

test('DEMO_PROMPT references the artifact filename so frontend + backend stay in sync', () => {
  // If someone renames DEMO_ARTIFACT_FILENAME without updating the
  // brief, the demo would fall back to whatever name sup invented.
  assert.ok(
    DEMO_PROMPT.includes(DEMO_ARTIFACT_FILENAME),
    `DEMO_PROMPT must mention ${DEMO_ARTIFACT_FILENAME}`,
  );
});

test('DEMO_PROMPT is concrete enough to skip onboarding (no questions)', () => {
  // The brief must be self-contained — sup should not need to call
  // ask_user. The phrase "Skip discovery" or "Skip questions" anchors
  // this contract; if it goes missing, sup will start asking the
  // operator about stack / scope and the 5-minute target slips.
  const skipsDiscovery = /skip discovery/i.test(DEMO_PROMPT);
  const skipsQuestions = /skip questions/i.test(DEMO_PROMPT);
  assert.ok(
    skipsDiscovery || skipsQuestions,
    'DEMO_PROMPT must instruct sup to skip onboarding questions',
  );
});

test('DEMO_PROMPT instructs sup to emit PHASE_COMPLETE so the demo terminates', () => {
  // Without this signal the demo loops forever. Brittle but
  // load-bearing — guard it explicitly.
  assert.match(DEMO_PROMPT, /<<PHASE_COMPLETE>>/);
});
