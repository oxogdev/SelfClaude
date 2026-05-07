import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bumpLastCommitAt,
  clearGitIsolation,
  readGitIsolation,
  writeGitIsolation,
} from '../src/project/git-isolation-store.js';

/**
 * Persistence module unit tests. Wraps each test in a temp dir +
 * env-override so the operator's real `<cwd>/.selfclaude/
 * git-isolation.json` is never touched.
 */

async function withFreshStore(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'sc-iso-store-'));
  const file = join(cwd, '.selfclaude', 'git-isolation.json');
  const prev = process.env.SELFCLAUDE_GIT_ISOLATION_PATH;
  process.env.SELFCLAUDE_GIT_ISOLATION_PATH = file;
  try {
    await fn(cwd);
  } finally {
    if (prev === undefined) delete process.env.SELFCLAUDE_GIT_ISOLATION_PATH;
    else process.env.SELFCLAUDE_GIT_ISOLATION_PATH = prev;
    await rm(cwd, { recursive: true, force: true });
  }
}

test('readGitIsolation returns null when file does not exist', async () => {
  await withFreshStore(async (cwd) => {
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('write + read round-trips a full record', async () => {
  await withFreshStore(async (cwd) => {
    const record = {
      version: 1 as const,
      enabled: true,
      branch: 'selfclaude/abc',
      originalBranch: 'main',
      startedAt: 1000,
      lastCommitAt: null,
    };
    await writeGitIsolation(cwd, record);
    const back = await readGitIsolation(cwd);
    assert.deepEqual(back, record);
  });
});

test('readGitIsolation returns null on malformed JSON', async () => {
  await withFreshStore(async (cwd) => {
    const file = process.env.SELFCLAUDE_GIT_ISOLATION_PATH!;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, '.selfclaude'), { recursive: true });
    await writeFile(file, '{not-json', 'utf8');
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('readGitIsolation returns null on schema mismatch', async () => {
  await withFreshStore(async (cwd) => {
    const file = process.env.SELFCLAUDE_GIT_ISOLATION_PATH!;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, '.selfclaude'), { recursive: true });
    // Right shape but wrong types — version 99 isn't allowed.
    await writeFile(file, JSON.stringify({ version: 99, enabled: true }), 'utf8');
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('clearGitIsolation removes the file', async () => {
  await withFreshStore(async (cwd) => {
    await writeGitIsolation(cwd, {
      version: 1,
      enabled: true,
      branch: 'selfclaude/x',
      originalBranch: 'main',
      startedAt: 1,
      lastCommitAt: null,
    });
    assert.notEqual(await readGitIsolation(cwd), null);
    await clearGitIsolation(cwd);
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('clearGitIsolation is a no-op when file does not exist', async () => {
  await withFreshStore(async (cwd) => {
    // Should not throw.
    await clearGitIsolation(cwd);
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('bumpLastCommitAt updates only the timestamp', async () => {
  await withFreshStore(async (cwd) => {
    const initial = {
      version: 1 as const,
      enabled: true,
      branch: 'selfclaude/y',
      originalBranch: 'main',
      startedAt: 1000,
      lastCommitAt: null,
    };
    await writeGitIsolation(cwd, initial);
    await bumpLastCommitAt(cwd, 2000);
    const back = await readGitIsolation(cwd);
    assert.equal(back?.lastCommitAt, 2000);
    // Other fields untouched.
    assert.equal(back?.branch, 'selfclaude/y');
    assert.equal(back?.originalBranch, 'main');
    assert.equal(back?.startedAt, 1000);
  });
});

test('bumpLastCommitAt is a no-op when file does not exist', async () => {
  // Race: accept/discard cleared the file mid-turn; auto-commit
  // races and bumps the ts. The bump shouldn't recreate state.
  await withFreshStore(async (cwd) => {
    await bumpLastCommitAt(cwd, 5000);
    assert.equal(await readGitIsolation(cwd), null);
  });
});

test('write overwrites previous record cleanly', async () => {
  await withFreshStore(async (cwd) => {
    await writeGitIsolation(cwd, {
      version: 1,
      enabled: true,
      branch: 'selfclaude/old',
      originalBranch: 'main',
      startedAt: 1,
      lastCommitAt: 1,
    });
    await writeGitIsolation(cwd, {
      version: 1,
      enabled: true,
      branch: 'selfclaude/new',
      originalBranch: 'develop',
      startedAt: 2,
      lastCommitAt: null,
    });
    const back = await readGitIsolation(cwd);
    assert.equal(back?.branch, 'selfclaude/new');
    assert.equal(back?.originalBranch, 'develop');
  });
});
