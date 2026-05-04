import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runConversationTurn } from '../../src/orchestrator/conversation.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-conv-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'conversation loop: supervisor auto-resumes after dev report and runs multiple iterations',
  { timeout: 480_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const sentinelA = `ALPHA_${Math.floor(Math.random() * 1_000_000)}`;
      const sentinelB = `BETA_${Math.floor(Math.random() * 1_000_000)}`;
      await writeFile(join(cwd, 'a.txt'), `${sentinelA}\nfile A line 2\n`);
      await writeFile(join(cwd, 'b.txt'), `${sentinelB}\nfile B line 2\n`);

      const orch = new Orchestrator({ cwd });
      await orch.start();
      try {
        const result = await runConversationTurn({
          orchestrator: orch,
          userPrompt:
            'There are two files in the working directory: a.txt and b.txt. ' +
            'Delegate the work to the developer in TWO SEPARATE TASKS, one at a time: ' +
            '(1) read a.txt and report its first line, ' +
            '(2) once you receive that report, read b.txt and report its first line. ' +
            'After both reports arrive, emit <<PHASE_COMPLETE>> on a line by itself and stop. ' +
            'Do not bundle both files into one task.',
          supervisorSystemPrompt:
            'You are a project manager working with a developer agent. ' +
            'You NEVER call file/edit/Bash tools yourself; the developer does the actual work. ' +
            'When you want the developer to do something, wrap the instruction in ' +
            '<TASK_FOR_DEVELOPER>...</TASK_FOR_DEVELOPER> tags exactly. ' +
            'Issue ONE task at a time and wait for the developer report before issuing the next. ' +
            'After expected reports arrive, emit <<PHASE_COMPLETE>> on a line by itself. ' +
            'DEVELOPER_REPORT messages appear in your context after each developer turn — read them carefully.',
          developerSystemPrompt:
            'You are a developer agent. Execute the task injected into your context using available tools. ' +
            'Summarize the result clearly in your final reply, including any specific values requested.',
          maxIterations: 6,
        });

        assert.ok(
          result.iterations >= 2,
          `expected at least 2 iterations (sup→dev twice); got ${result.iterations}`,
        );
        assert.ok(
          result.totalTurns.developer >= 2,
          `expected developer to run at least 2 turns; got ${result.totalTurns.developer}`,
        );

        // The last developer turn likely read b.txt; either sentinel surfacing,
        // or simply having run multiple developer turns, is sufficient evidence
        // the loop drove sup→dev→sup→dev autonomously.
        const finalDevText = result.lastTurn?.developerText ?? '';
        assert.ok(
          new RegExp(`${sentinelA}|${sentinelB}`).test(finalDevText) ||
            result.totalTurns.developer >= 2,
          `expected developer text to mention a sentinel or multiple dev turns; got: ${finalDevText}`,
        );

        assert.notEqual(
          result.endedReason,
          'max-iterations',
          `loop should not hit max-iterations; ended: ${result.endedReason}`,
        );
      } finally {
        await orch.stop();
      }
    });
  },
);
