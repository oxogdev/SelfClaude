import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator, type PendingQuestionView } from '../../src/orchestrator/index.js';
import { runDualAgentTurn } from '../../src/orchestrator/loop.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-ask-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'ask_user: supervisor calls MCP tool, orchestrator surfaces question, test answers, supervisor receives',
  { timeout: 240_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const sentinel = `MAGENTA_${Math.floor(Math.random() * 1_000_000)}`;
      const captured: { value: PendingQuestionView | null } = { value: null };

      const orch = new Orchestrator({ cwd });
      await orch.start();

      // Listen for the user-question event the orchestrator emits when the
      // supervisor's ask_user MCP call lands; resolve it with our sentinel.
      orch.on('user-question', (q: PendingQuestionView) => {
        captured.value = q;
        // Resolve asynchronously so the bridge's HTTP roundtrip cleanly returns.
        setImmediate(() => orch.resolveUserQuestion(q.id, sentinel));
      });

      try {
        const result = await runDualAgentTurn({
          orchestrator: orch,
          userPrompt:
            "Use the ask_user tool to ask the user: 'What is today's password?' " +
            'After you receive the answer, repeat the answer back verbatim in your final reply, ' +
            'prefixed with: ANSWERED:',
          supervisorSystemPrompt:
            'You have a tool called ask_user from the selfclaude MCP server. ' +
            'When the user asks you to ask them a question, you MUST call that tool ' +
            '(never answer questions on the user\'s behalf, never put the question into your text response). ' +
            'After receiving the tool result, restate the answer verbatim.',
        });

        assert.ok(captured.value, 'orchestrator should have surfaced a user-question event');
        assert.equal(captured.value!.role, 'supervisor');
        assert.match(
          captured.value!.question.toLowerCase(),
          /password/,
          `expected the question to mention password; got "${captured.value!.question}"`,
        );

        assert.match(
          result.supervisorText,
          new RegExp(sentinel),
          `supervisor should have echoed the sentinel ${sentinel}; got: ${result.supervisorText}`,
        );

        // No questions should remain pending after resolution.
        assert.equal(orch.listPendingQuestions().length, 0);
      } finally {
        await orch.stop();
      }
    });
  },
);
