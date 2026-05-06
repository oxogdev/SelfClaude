import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyAgentDna,
  DNA_TEMPLATES,
  getDnaTemplate,
  listDnaTemplates,
  projectAgentPromptPath,
  readProjectAgentPrompt,
} from '../src/agents/dna.js';

async function withTempCwd<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-dna-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('admin-panel template ships in the registry', () => {
  const tpl = getDnaTemplate('admin-panel');
  assert.ok(tpl, 'admin-panel template must be registered');
  assert.equal(tpl!.agent, 'ui-dev');
  assert.equal(tpl!.file, 'admin-panel.md');
});

test('listDnaTemplates returns all entries from DNA_TEMPLATES', () => {
  const all = listDnaTemplates();
  assert.equal(all.length, Object.keys(DNA_TEMPLATES).length);
});

test('getDnaTemplate returns null for unknown slug', () => {
  assert.equal(getDnaTemplate('does-not-exist'), null);
});

test('applyAgentDna copies the bundled template into the project', async () => {
  await withTempCwd(async (cwd) => {
    const result = await applyAgentDna(cwd, 'admin-panel');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.agent, 'ui-dev');
    const written = await readFile(result.destPath, 'utf8');
    // Sanity: the template starts with its title.
    assert.match(written, /Admin Panel UI Agent/);
    // And lands at the project-relative path the loader expects.
    assert.equal(result.destPath, projectAgentPromptPath(cwd, 'ui-dev.md'));
  });
});

test('applyAgentDna returns ok:false / "already-applied" on second call without force', async () => {
  await withTempCwd(async (cwd) => {
    const first = await applyAgentDna(cwd, 'admin-panel');
    assert.equal(first.ok, true);
    const second = await applyAgentDna(cwd, 'admin-panel');
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.reason, 'already-applied');
  });
});

test('applyAgentDna with force:true overwrites existing file', async () => {
  await withTempCwd(async (cwd) => {
    const first = await applyAgentDna(cwd, 'admin-panel');
    assert.equal(first.ok, true);
    if (!first.ok) return;
    // Operator hand-edit
    await writeFile(first.destPath, '# my custom DNA\n');
    const second = await applyAgentDna(cwd, 'admin-panel', { force: true });
    assert.equal(second.ok, true);
    const written = await readFile(first.destPath, 'utf8');
    assert.match(written, /Admin Panel UI Agent/);
    assert.doesNotMatch(written, /my custom DNA/);
  });
});

test('applyAgentDna rejects unknown slug', async () => {
  await withTempCwd(async (cwd) => {
    const r = await applyAgentDna(cwd, 'no-such-template');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'unknown-template');
  });
});

test('readProjectAgentPrompt returns null when file missing', async () => {
  await withTempCwd(async (cwd) => {
    const out = readProjectAgentPrompt(cwd, 'ui-dev.md');
    assert.equal(out, null);
  });
});

test('readProjectAgentPrompt returns the content when file exists', async () => {
  await withTempCwd(async (cwd) => {
    const r = await applyAgentDna(cwd, 'admin-panel');
    assert.equal(r.ok, true);
    const content = readProjectAgentPrompt(cwd, 'ui-dev.md');
    assert.ok(content);
    assert.match(content!, /Admin Panel UI Agent/);
  });
});
