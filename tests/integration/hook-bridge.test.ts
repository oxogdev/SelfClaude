import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runClaudeTurn } from '../../src/claude-code/spawn.js';
import { extractAssistantText } from '../../src/orchestrator/stream-parser.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-bridge-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'hook bridge: pre-enqueued message reaches the developer turn via UserPromptSubmit injection',
  { timeout: 120_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const orch = new Orchestrator({ cwd });
      await orch.start();

      // Capture Stop hook fires for assertions.
      const stopFires: { role: string }[] = [];
      orch.on('hook:stop', (e: { role: string }) => stopFires.push({ role: e.role }));

      try {
        const sentinel = `PINGER_${Math.floor(Math.random() * 1_000_000)}`;
        orch.messages.enqueue({
          to: 'developer',
          source: 'supervisor',
          body: `Sentinel from supervisor: ${sentinel}`,
        });

        const ws = orch.getWorkspace();
        const env = orch.hookEnv('developer');

        const result = await runClaudeTurn({
          role: 'developer',
          cwd,
          prompt:
            'Inspect any context that was injected into this turn. ' +
            'If you can see a sentinel that starts with PINGER_, reply with that sentinel verbatim and nothing else. ' +
            'If you cannot see one, reply with the single word: NONE.',
          settingsPath: ws.settingsPath,
          envOverrides: env,
          enableChrome: false,
        });

        assert.equal(result.exitCode, 0, `non-zero exit; stderr=${result.stderr}`);
        const text = result.events
          .filter((e) => e.type === 'assistant')
          .map(extractAssistantText)
          .join('');
        assert.match(
          text,
          new RegExp(sentinel),
          `expected assistant to echo sentinel ${sentinel}; got "${text}"`,
        );

        // Stop hook should also have fired at least once for the developer.
        assert.ok(
          stopFires.some((f) => f.role === 'developer'),
          'Stop hook should have fired for developer',
        );
      } finally {
        await orch.stop();
      }
    });
  },
);
