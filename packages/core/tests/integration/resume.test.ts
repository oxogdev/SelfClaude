import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runDualAgentTurn } from '../../src/orchestrator/loop.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-resume-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'resume: orchestrator restart loads existing state and resumed supervisor recalls earlier turn',
  { timeout: 240_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const sentinel = `RECALL_${Math.floor(Math.random() * 1_000_000)}`;
      let firstSupervisorSessionId: string | null = null;

      // First orchestrator session: tell sup a number, persist session id.
      {
        const orch = new Orchestrator({ cwd });
        const r = await orch.start();
        assert.equal(r.existing, false, 'first run should be a fresh init');
        try {
          const turn = await runDualAgentTurn({
            orchestrator: orch,
            userPrompt:
              `Remember the number ${sentinel}. Reply briefly to confirm. ` +
              'Do not delegate anything to the developer this turn.',
            // Override the default supervisor system prompt — we are testing
            // session continuity, not the discovery/docs flow.
            supervisorSystemPrompt:
              'You are a memory-keeping assistant. Just respond directly. ' +
              'Do not call any MCP tools, do not write files, do not emit any tag.',
          });
          assert.ok(turn.supervisorSessionId, 'sup session id should be assigned');
          firstSupervisorSessionId = turn.supervisorSessionId;

          const persisted = orch.getProjectState();
          assert.equal(persisted.supervisorSessionId, turn.supervisorSessionId);
        } finally {
          await orch.stop();
        }
      }

      // Second orchestrator session: detect existing, resume.
      {
        const orch = new Orchestrator({ cwd });
        const r = await orch.start();
        assert.equal(r.existing, true, 'second run should detect existing project');
        assert.equal(r.projectState.supervisorSessionId, firstSupervisorSessionId);

        try {
          const state = orch.getProjectState();
          assert.ok(state.supervisorSessionId);
          const turn = await runDualAgentTurn({
            orchestrator: orch,
            userPrompt:
              'What number did I ask you to remember in our previous turn? Reply with just the number.',
            supervisorSessionId: state.supervisorSessionId ?? undefined,
            supervisorSystemPrompt:
              'You are a memory-keeping assistant. Just respond directly. ' +
              'Do not call any MCP tools, do not write files, do not emit any tag.',
          });
          assert.match(
            turn.supervisorText,
            new RegExp(sentinel),
            `expected resumed sup to recall ${sentinel}; got: ${turn.supervisorText}`,
          );
        } finally {
          await orch.stop();
        }
      }
    });
  },
);
