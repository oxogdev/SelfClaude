import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installWorkspace, workspacePaths } from '../src/hooks/installer.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-installer-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('workspacePaths derives expected layout', () => {
  const p = workspacePaths('/tmp/proj');
  assert.equal(p.workspaceDir, '/tmp/proj/.selfclaude');
  assert.equal(p.hooksDir, '/tmp/proj/.selfclaude/hooks');
  assert.equal(p.settingsPath, '/tmp/proj/.selfclaude/settings.json');
  assert.equal(p.scripts['stop.sh'], '/tmp/proj/.selfclaude/hooks/stop.sh');
});

test('installWorkspace creates dirs, copies scripts (executable), writes settings.json + mcp-config.json', async () => {
  await withTempDir(async (dir) => {
    const paths = await installWorkspace(dir);

    // hooks dir + scripts copied with exec bits
    for (const file of ['stop.sh', 'pretool.sh', 'prompt-inject.sh'] as const) {
      const dest = paths.scripts[file];
      const st = await stat(dest);
      assert.ok(st.isFile(), `${file} should be a file`);
      // 0o100 = owner exec bit
      assert.ok((st.mode & 0o100) !== 0, `${file} should be executable`);
    }

    // settings.json structure
    const settings = JSON.parse(await readFile(paths.settingsPath, 'utf8'));
    assert.ok(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command);
    assert.ok(settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command);
    assert.ok(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command);
    assert.equal(
      settings.hooks.Stop[0].hooks[0].command,
      paths.scripts['stop.sh'],
    );

    // mcp-config.json structure
    const mcp = JSON.parse(await readFile(paths.mcpConfigPath, 'utf8'));
    assert.ok(mcp.mcpServers?.selfclaude?.command);
    assert.ok(Array.isArray(mcp.mcpServers.selfclaude.args));
    assert.ok(
      mcp.mcpServers.selfclaude.args[0].endsWith('bridge.ts'),
      `expected bridge.ts entry, got ${mcp.mcpServers.selfclaude.args[0]}`,
    );
  });
});
