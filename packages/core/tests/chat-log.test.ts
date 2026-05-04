import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendChatLogEntry, chatLogPath, readChatLog } from '../src/project/chat-log.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-chatlog-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('append + read round-trip preserves entries in order', async () => {
  await withTempDir(async (cwd) => {
    await appendChatLogEntry(cwd, { type: 'user-message', text: 'hi', ts: 1 });
    await appendChatLogEntry(cwd, { type: 'sup-message', text: 'hello', ts: 2 });
    await appendChatLogEntry(cwd, {
      type: 'dev-tool-call',
      id: 'e1',
      toolUseId: 'tu_1',
      name: 'Bash',
      input: { command: 'ls' },
      ts: 3,
    });
    const entries = await readChatLog(cwd);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.type, 'user-message');
    assert.equal(entries[1]!.type, 'sup-message');
    assert.equal(entries[2]!.type, 'dev-tool-call');
  });
});

test('readChatLog returns [] when file missing', async () => {
  await withTempDir(async (cwd) => {
    const r = await readChatLog(cwd);
    assert.deepEqual(r, []);
  });
});

test('readChatLog skips malformed lines silently', async () => {
  await withTempDir(async (cwd) => {
    const path = chatLogPath(cwd);
    await mkdir(join(cwd, '.selfclaude'), { recursive: true });
    await writeFile(
      path,
      ['not json', '{"type":"user-message","text":"ok","ts":1}', '', 'broken{'].join('\n') + '\n',
    );
    const entries = await readChatLog(cwd);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, 'user-message');
  });
});

test('readChatLog rejects entries that fail schema validation', async () => {
  await withTempDir(async (cwd) => {
    const path = chatLogPath(cwd);
    await mkdir(join(cwd, '.selfclaude'), { recursive: true });
    await writeFile(
      path,
      ['{"type":"unknown-kind","data":"x"}', '{"type":"user-message","text":"ok","ts":2}'].join('\n') + '\n',
    );
    const entries = await readChatLog(cwd);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, 'user-message');
  });
});
