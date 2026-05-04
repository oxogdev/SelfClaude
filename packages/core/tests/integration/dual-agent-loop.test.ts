import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runDualAgentTurn } from '../../src/orchestrator/loop.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-loop-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'dual-agent loop: supervisor delegates via TASK_FOR_DEVELOPER, developer executes, report lands in supervisor inbox',
  { timeout: 240_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const sentinel = `WIDGET_${Math.floor(Math.random() * 1_000_000)}`;
      await writeFile(
        join(cwd, 'README.md'),
        `${sentinel}\nThis is the widget README.\nThird line.\n`,
      );

      const orch = new Orchestrator({ cwd });
      await orch.start();
      try {
        const result = await runDualAgentTurn({
          orchestrator: orch,
          userPrompt:
            'Ask the developer to read the file README.md and report back exactly its first line. ' +
            'Delegate the read to the developer using the TASK_FOR_DEVELOPER tag — do not read the file yourself.',
          supervisorSystemPrompt:
            'You are a project manager working with a developer agent. ' +
            'You NEVER call file or edit tools yourself; the developer does the actual work. ' +
            'When you want the developer to do something, wrap the instruction in ' +
            '<TASK_FOR_DEVELOPER>...</TASK_FOR_DEVELOPER> tags exactly. ' +
            'Keep the tag content focused, actionable, and self-contained.',
          developerSystemPrompt:
            'You are a developer agent. Execute the task injected into your context using the available tools. ' +
            'When done, summarize the result clearly in your final reply.',
        });

        assert.ok(
          result.tasksDelegated > 0,
          `supervisor should produce at least one TASK_FOR_DEVELOPER; got text:\n${result.supervisorText}`,
        );
        assert.equal(result.developerExecuted, true);
        assert.match(
          result.developerText,
          new RegExp(sentinel),
          `developer report should contain the sentinel ${sentinel}; got:\n${result.developerText}`,
        );

        // The dev report must have been routed back to the supervisor inbox.
        const supInbox = orch.messages.peek('supervisor');
        assert.equal(supInbox.length, 1, 'expected one DEVELOPER_REPORT in supervisor inbox');
        const reportMsg = supInbox[0]!;
        assert.equal(reportMsg.source, 'developer');
        assert.match(reportMsg.body, /DEVELOPER_REPORT/);
        assert.match(reportMsg.body, new RegExp(sentinel));
      } finally {
        await orch.stop();
      }
    });
  },
);
