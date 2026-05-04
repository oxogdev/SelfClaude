import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runDualAgentTurn } from '../../src/orchestrator/loop.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-discovery-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'discovery flow: supervisor writes a phase doc via MCP, emits READY_TO_EXECUTE, FSM advances to phase-loop',
  { timeout: 240_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const sentinel = `URLSHORT_${Math.floor(Math.random() * 1_000_000)}`;
      const orch = new Orchestrator({ cwd });
      await orch.start();

      // If supervisor decides to ask the user something, auto-answer with a curt OK.
      orch.on('user-question', (q: { id: string }) => {
        setImmediate(() => orch.resolveUserQuestion(q.id, 'OK, proceed.'));
      });

      const phaseDocsWritten: string[] = [];
      orch.on('phase-doc-written', (e: { filename: string }) => {
        phaseDocsWritten.push(e.filename);
      });

      try {
        const result = await runDualAgentTurn({
          orchestrator: orch,
          userPrompt:
            `New project: a tiny URL shortener (Postgres + Node). Skip the discovery questions; ` +
            `the scope is already clear. In this single reply: ` +
            `(1) call the write_phase_doc MCP tool to create a brief 00-overview.md that includes ` +
            `the literal sentinel \`${sentinel}\` somewhere in its body; ` +
            `(2) emit the literal token <<READY_TO_EXECUTE>> on a line by itself. ` +
            `Do not delegate any TASK_FOR_DEVELOPER yet.`,
        });

        // Phase doc was written.
        assert.ok(
          phaseDocsWritten.length >= 1,
          `expected phase-doc-written event; got ${phaseDocsWritten.length}`,
        );
        const expectedPath = join(cwd, 'docs', 'phases', phaseDocsWritten[0]!);
        const st = await stat(expectedPath).catch(() => null);
        assert.ok(st, `phase doc should exist at ${expectedPath}`);
        const content = await readFile(expectedPath, 'utf8');
        assert.match(content, new RegExp(sentinel), `phase doc should contain sentinel ${sentinel}`);

        // Signal was extracted and FSM advanced.
        assert.ok(
          result.signals.includes('ready-to-execute'),
          `expected ready-to-execute signal; got ${JSON.stringify(result.signals)}`,
        );
        assert.equal(result.phase, 'phase-loop');
        const fsmState = orch.getState();
        assert.notEqual(fsmState.tag, 'shutdown');
        if (fsmState.tag !== 'shutdown') {
          assert.equal(fsmState.phase, 'phase-loop');
        }

        // No developer tasks were delegated this turn.
        assert.equal(result.tasksDelegated, 0);
        assert.equal(result.developerExecuted, false);
      } finally {
        await orch.stop();
      }
    });
  },
);
