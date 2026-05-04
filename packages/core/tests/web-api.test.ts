import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWebApi } from '../src/server/web-api.js';
import { SessionManager } from '../src/server/session-manager.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-webapi-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('GET /api/health returns version, uptime, and sessions count', async () => {
  const mgr = new SessionManager();
  const server = buildWebApi(mgr);
  try {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.version);
    assert.equal(body.sessions, 0);
    assert.ok(typeof body.uptime === 'number');
  } finally {
    await server.close();
    await mgr.destroyAll();
  }
});

test('POST/GET/DELETE /api/sessions full lifecycle', async () => {
  await withTempDir(async (cwd) => {
    const mgr = new SessionManager();
    const server = buildWebApi(mgr);
    try {
      const create = await server.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { 'content-type': 'application/json' },
        payload: { cwd, label: 'test' },
      });
      assert.equal(create.statusCode, 200);
      const meta = create.json();
      assert.ok(meta.id);
      assert.equal(meta.label, 'test');

      const list = await server.inject({ method: 'GET', url: '/api/sessions' });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().sessions.length, 1);

      const detail = await server.inject({
        method: 'GET',
        url: `/api/sessions/${meta.id}`,
      });
      assert.equal(detail.statusCode, 200);
      const snap = detail.json();
      assert.equal(snap.meta.id, meta.id);
      assert.deepEqual(snap.chatLog, []);

      const del = await server.inject({
        method: 'DELETE',
        url: `/api/sessions/${meta.id}`,
      });
      assert.equal(del.statusCode, 204);

      const list2 = await server.inject({ method: 'GET', url: '/api/sessions' });
      assert.equal(list2.json().sessions.length, 0);
    } finally {
      await server.close();
      await mgr.destroyAll();
    }
  });
});

test('GET /api/sessions/:id returns 404 when missing', async () => {
  const mgr = new SessionManager();
  const server = buildWebApi(mgr);
  try {
    const res = await server.inject({ method: 'GET', url: '/api/sessions/no-such-id' });
    assert.equal(res.statusCode, 404);
  } finally {
    await server.close();
    await mgr.destroyAll();
  }
});

test('POST /api/sessions/:id/message returns 400 when session missing', async () => {
  const mgr = new SessionManager();
  const server = buildWebApi(mgr);
  try {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sessions/no-such-id/message',
      headers: { 'content-type': 'application/json' },
      payload: { text: 'hi' },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await server.close();
    await mgr.destroyAll();
  }
});

test('POST /api/sessions rejects body without cwd', async () => {
  const mgr = new SessionManager();
  const server = buildWebApi(mgr);
  try {
    const res = await server.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { 'content-type': 'application/json' },
      payload: { label: 'no-cwd' },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await server.close();
    await mgr.destroyAll();
  }
});

test('GET /api/browse returns home dir entries by default', async () => {
  const mgr = new SessionManager();
  const server = buildWebApi(mgr);
  try {
    const res = await server.inject({ method: 'GET', url: '/api/browse' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.path);
    assert.ok(Array.isArray(body.entries));
  } finally {
    await server.close();
    await mgr.destroyAll();
  }
});

test('answer-question / decide-approval return ok=false when ids do not match', async () => {
  await withTempDir(async (cwd) => {
    const mgr = new SessionManager();
    const server = buildWebApi(mgr);
    try {
      const create = await server.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { 'content-type': 'application/json' },
        payload: { cwd },
      });
      const meta = create.json();
      const q = await server.inject({
        method: 'POST',
        url: `/api/sessions/${meta.id}/answer-question`,
        headers: { 'content-type': 'application/json' },
        payload: { questionId: 'no-such', answer: 'x' },
      });
      assert.equal(q.statusCode, 200);
      assert.equal(q.json().ok, false);
      const a = await server.inject({
        method: 'POST',
        url: `/api/sessions/${meta.id}/decide-approval`,
        headers: { 'content-type': 'application/json' },
        payload: { approvalId: 'no-such', decision: 'allow' },
      });
      assert.equal(a.statusCode, 200);
      assert.equal(a.json().ok, false);
    } finally {
      await server.close();
      await mgr.destroyAll();
    }
  });
});
