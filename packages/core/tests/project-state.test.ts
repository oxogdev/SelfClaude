import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newProjectState,
  readProjectState,
  writeProjectState,
} from '../src/project/state.js';
import { detectProject } from '../src/project/detect.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-state-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('newProjectState has version 1, discovery phase, null sessions, empty docs', () => {
  const s = newProjectState();
  assert.equal(s.version, 1);
  assert.equal(s.phase, 'discovery');
  assert.equal(s.supervisorSessionId, null);
  assert.equal(s.developerSessionId, null);
  assert.deepEqual(s.phaseDocs, []);
  assert.ok(s.createdAt);
  assert.ok(s.updatedAt);
});

test('write then read round-trips and bumps updatedAt', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    const original = newProjectState();
    original.supervisorSessionId = 'abc';
    original.phase = 'docs';
    await writeProjectState(path, original);
    const loaded = await readProjectState(path);
    assert.ok(loaded);
    assert.equal(loaded!.supervisorSessionId, 'abc');
    assert.equal(loaded!.phase, 'docs');
    // updatedAt should have been refreshed
    assert.ok(loaded!.updatedAt >= original.createdAt);
  });
});

test('readProjectState returns null when the file does not exist', async () => {
  await withTempDir(async (dir) => {
    const r = await readProjectState(join(dir, 'missing.json'));
    assert.equal(r, null);
  });
});

test('readProjectState throws on malformed JSON (corrupted state must surface)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    await writeFile(path, 'not-valid-json{');
    await assert.rejects(() => readProjectState(path));
  });
});

test('readProjectState throws on schema mismatch (unknown version, missing field)', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ version: 999 }));
    await assert.rejects(() => readProjectState(path));
  });
});

test('detectProject returns "new" for an empty cwd', async () => {
  await withTempDir(async (dir) => {
    const r = await detectProject(dir);
    assert.equal(r.kind, 'new');
    assert.ok(r.statePath.endsWith('.selfclaude/state.json'));
  });
});

test('detectProject returns "existing" with the parsed state when state.json is present', async () => {
  await withTempDir(async (dir) => {
    const statePath = join(dir, '.selfclaude', 'state.json');
    const s = newProjectState();
    s.phase = 'phase-loop';
    s.supervisorSessionId = 'sup-1';
    await writeProjectState(statePath, s);
    const r = await detectProject(dir);
    assert.equal(r.kind, 'existing');
    if (r.kind === 'existing') {
      assert.equal(r.state.phase, 'phase-loop');
      assert.equal(r.state.supervisorSessionId, 'sup-1');
    }
  });
});

test('writeProjectState writes pretty-printed JSON with trailing newline', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'state.json');
    await writeProjectState(path, newProjectState());
    const raw = await readFile(path, 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('\n  "version": 1'));
  });
});
