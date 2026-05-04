import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../src/server/session-manager.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-sm-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('createSession returns meta with id, cwd, label, busy=false', async () => {
  await withTempDir(async (cwd) => {
    const mgr = new SessionManager();
    try {
      const meta = await mgr.createSession({ cwd });
      assert.ok(meta.id);
      assert.equal(meta.cwd, cwd);
      assert.equal(meta.busy, false);
      assert.ok(meta.createdAt > 0);
      assert.equal(meta.label.length > 0, true);
    } finally {
      await mgr.destroyAll();
    }
  });
});

test('listSessions reflects creates and destroys', async () => {
  await withTempDir(async (cwdA) => {
    await withTempDir(async (cwdB) => {
      const mgr = new SessionManager();
      try {
        const a = await mgr.createSession({ cwd: cwdA, label: 'A' });
        const b = await mgr.createSession({ cwd: cwdB, label: 'B' });
        assert.equal(mgr.listSessions().length, 2);
        await mgr.destroySession(a.id);
        const list = mgr.listSessions();
        assert.equal(list.length, 1);
        assert.equal(list[0]!.id, b.id);
      } finally {
        await mgr.destroyAll();
      }
    });
  });
});

test('sendMessage on missing session throws', async () => {
  const mgr = new SessionManager();
  try {
    await assert.rejects(() => mgr.sendMessage('no-such-id', 'hi'));
  } finally {
    await mgr.destroyAll();
  }
});

test('getSnapshot returns null for missing session', async () => {
  const mgr = new SessionManager();
  try {
    const snap = await mgr.getSnapshot('no-such-id');
    assert.equal(snap, null);
  } finally {
    await mgr.destroyAll();
  }
});

test('getSnapshot returns chat log + meta after createSession', async () => {
  await withTempDir(async (cwd) => {
    const mgr = new SessionManager();
    try {
      const meta = await mgr.createSession({ cwd });
      const snap = await mgr.getSnapshot(meta.id);
      assert.ok(snap);
      assert.equal(snap!.meta.id, meta.id);
      assert.deepEqual(snap!.chatLog, []);
      assert.deepEqual(snap!.pendingQuestions, []);
      assert.deepEqual(snap!.pendingApprovals, []);
    } finally {
      await mgr.destroyAll();
    }
  });
});
