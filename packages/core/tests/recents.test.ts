import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearRecents,
  listRecents,
  recordRecent,
  removeRecent,
} from '../src/server/recents.js';

/**
 * Recents store unit tests. We override the persistence path via
 * SELFCLAUDE_RECENTS_PATH so the tests use a temp file — the real
 * ~/.selfclaude/recents.json stays untouched.
 *
 * Each test wraps its own withFreshStore() so test order doesn't
 * matter and the env override + file are restored cleanly.
 */

async function withFreshStore(fn: (workspaceDir: string) => Promise<void>): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), 'sc-recents-'));
  const recentsFile = join(baseDir, 'recents.json');
  const workspaceDir = join(baseDir, 'workspace');
  await mkdir(workspaceDir, { recursive: true });

  const prev = process.env.SELFCLAUDE_RECENTS_PATH;
  process.env.SELFCLAUDE_RECENTS_PATH = recentsFile;
  try {
    await fn(workspaceDir);
  } finally {
    if (prev === undefined) delete process.env.SELFCLAUDE_RECENTS_PATH;
    else process.env.SELFCLAUDE_RECENTS_PATH = prev;
    await rm(baseDir, { recursive: true, force: true });
  }
}

test('listRecents on empty store returns empty array', async () => {
  await withFreshStore(async () => {
    assert.deepEqual(listRecents(), []);
  });
});

test('recordRecent persists then listRecents returns it', async () => {
  await withFreshStore(async (cwd) => {
    const entry = recordRecent(cwd, 'My Project');
    assert.equal(entry.cwd, cwd);
    assert.equal(entry.label, 'My Project');
    assert.ok(entry.openedAt > 0);

    const list = listRecents();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.cwd, cwd);
    assert.equal(list[0]!.label, 'My Project');
  });
});

test('recordRecent on existing cwd refreshes openedAt and dedupes', async () => {
  await withFreshStore(async (cwd) => {
    recordRecent(cwd, 'First label');
    const firstList = listRecents();
    const firstTs = firstList[0]!.openedAt;

    // Wait at least 1ms so the second timestamp is strictly greater.
    await new Promise((r) => setTimeout(r, 5));

    recordRecent(cwd, 'Second label');
    const secondList = listRecents();
    assert.equal(secondList.length, 1, 'should not duplicate same cwd');
    assert.equal(secondList[0]!.label, 'Second label', 'label should update');
    assert.ok(secondList[0]!.openedAt > firstTs, 'openedAt should refresh');
  });
});

test('recordRecent puts newest first (MRU order)', async () => {
  await withFreshStore(async (workspaceDir) => {
    // Use sibling temp dirs so each entry has its own existing cwd.
    const a = workspaceDir;
    const b = join(workspaceDir, '..', 'workspace-b');
    const c = join(workspaceDir, '..', 'workspace-c');
    await mkdir(b, { recursive: true });
    await mkdir(c, { recursive: true });

    recordRecent(a);
    await new Promise((r) => setTimeout(r, 5));
    recordRecent(b);
    await new Promise((r) => setTimeout(r, 5));
    recordRecent(c);

    const list = listRecents();
    assert.equal(list.length, 3);
    assert.equal(list[0]!.cwd, c, 'most-recently-recorded first');
    assert.equal(list[1]!.cwd, b);
    assert.equal(list[2]!.cwd, a);
  });
});

test('listRecents lazy-prunes entries whose cwd no longer exists', async () => {
  await withFreshStore(async (workspaceDir) => {
    const ghost = join(workspaceDir, '..', 'doesnt-exist');
    recordRecent(workspaceDir);
    recordRecent(ghost); // Recorded fine, but the directory doesn't exist.

    const list = listRecents();
    assert.equal(list.length, 1, 'ghost entry should be filtered on read');
    assert.equal(list[0]!.cwd, workspaceDir);
  });
});

test('default label derives from basename when label is empty', async () => {
  await withFreshStore(async (workspaceDir) => {
    const entry = recordRecent(workspaceDir);
    // workspaceDir was created via mkdtemp so basename is non-empty.
    const expected = workspaceDir.split('/').filter(Boolean).pop();
    assert.equal(entry.label, expected);
  });
});

test('removeRecent drops entry by cwd and returns true', async () => {
  await withFreshStore(async (cwd) => {
    recordRecent(cwd);
    assert.equal(removeRecent(cwd), true);
    assert.equal(listRecents().length, 0);
  });
});

test('removeRecent returns false when cwd is not present', async () => {
  await withFreshStore(async (cwd) => {
    recordRecent(cwd);
    assert.equal(removeRecent('/nope'), false);
    assert.equal(listRecents().length, 1, 'unrelated entry untouched');
  });
});

test('clearRecents wipes the store', async () => {
  await withFreshStore(async (cwd) => {
    recordRecent(cwd);
    clearRecents();
    assert.equal(listRecents().length, 0);
  });
});

test('recents cap at 20 entries — oldest fall off', async () => {
  await withFreshStore(async (workspaceDir) => {
    // Create 25 sibling dirs and record each. Only the latest 20
    // should survive; the first 5 get evicted from the tail.
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const dir = join(workspaceDir, '..', `proj-${i}`);
      await mkdir(dir, { recursive: true });
      created.push(dir);
      recordRecent(dir, `proj-${i}`);
      // Tiny pause so ordering is deterministic.
      await new Promise((r) => setTimeout(r, 1));
    }
    const list = listRecents();
    assert.equal(list.length, 20, 'cap enforced');
    // Newest first → list[0] is proj-24, list[19] is proj-5; proj-0..4 evicted.
    assert.equal(list[0]!.label, 'proj-24');
    assert.equal(list[19]!.label, 'proj-5');
  });
});
