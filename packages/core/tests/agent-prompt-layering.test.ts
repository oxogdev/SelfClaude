import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_AGENTS,
  clearPromptCache,
  loadAgentPrompt,
} from '../src/agents/registry.js';

async function withTempCwd<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-prompt-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadAgentPrompt without cwd returns just the bundled base', () => {
  clearPromptCache();
  const out = loadAgentPrompt(BUILTIN_AGENTS['ui-dev']);
  // Base prompt should be present, project DNA marker should NOT.
  assert.match(out, /SelfClaude/i);
  assert.doesNotMatch(out, /Project DNA — additional standards/);
});

test('loadAgentPrompt with cwd but no addendum returns just the bundled base', async () => {
  clearPromptCache();
  await withTempCwd(async (cwd) => {
    const out = loadAgentPrompt(BUILTIN_AGENTS['ui-dev'], cwd);
    assert.doesNotMatch(out, /Project DNA — additional standards/);
  });
});

test('loadAgentPrompt with cwd + addendum file appends the addendum', async () => {
  clearPromptCache();
  await withTempCwd(async (cwd) => {
    const promptDir = join(cwd, '.selfclaude', 'agent-prompts');
    await mkdir(promptDir, { recursive: true });
    await writeFile(
      join(promptDir, 'ui-dev.md'),
      '# Custom DNA for this project\n\nSome project-specific rules here.\n',
    );
    const out = loadAgentPrompt(BUILTIN_AGENTS['ui-dev'], cwd);
    assert.match(out, /Project DNA — additional standards/);
    assert.match(out, /Custom DNA for this project/);
    assert.match(out, /Some project-specific rules here/);
  });
});

test('addendum mtime change invalidates the prompt cache', async () => {
  clearPromptCache();
  await withTempCwd(async (cwd) => {
    const promptDir = join(cwd, '.selfclaude', 'agent-prompts');
    await mkdir(promptDir, { recursive: true });
    const path = join(promptDir, 'ui-dev.md');
    await writeFile(path, '# v1\n');
    const first = loadAgentPrompt(BUILTIN_AGENTS['ui-dev'], cwd);
    assert.match(first, /# v1/);
    // Wait a tick so mtime ticks forward, then update.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(path, '# v2 — different content\n');
    const second = loadAgentPrompt(BUILTIN_AGENTS['ui-dev'], cwd);
    assert.match(second, /v2/);
    assert.doesNotMatch(second, /^# v1$/m);
  });
});
