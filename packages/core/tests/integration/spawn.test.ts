import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runClaudeTurn } from '../../src/claude-code/spawn.js';
import { extractAssistantText } from '../../src/orchestrator/stream-parser.js';

test(
  'live: claude responds to a one-shot prompt and emits session id + result',
  { timeout: 90_000 },
  async () => {
    const result = await runClaudeTurn({
      role: 'supervisor',
      cwd: '/tmp',
      prompt: 'Reply with the single word: ok',
      // Disable chrome integration in CI/headless to keep the test fast and deterministic.
      enableChrome: false,
    });

    assert.equal(result.exitCode, 0, `non-zero exit; stderr=${result.stderr}`);
    assert.ok(result.sessionId, 'expected a session id from the init event');
    assert.ok(result.events.length > 0, 'expected at least one event');

    const assistantText = result.events
      .filter((e) => e.type === 'assistant')
      .map(extractAssistantText)
      .join('')
      .toLowerCase();
    assert.match(assistantText, /ok/, `unexpected assistant text: "${assistantText}"`);

    const resultEvt = result.events.find((e) => e.type === 'result');
    assert.ok(resultEvt, 'expected a result event');

    // Parser should have produced no errors on healthy CC output.
    assert.equal(
      result.parserErrors.length,
      0,
      `parser errors: ${JSON.stringify(result.parserErrors)}`,
    );
  },
);

test(
  'live: resuming a session preserves conversational state',
  { timeout: 120_000 },
  async () => {
    const first = await runClaudeTurn({
      role: 'supervisor',
      cwd: '/tmp',
      prompt: 'Remember the number 4242. Reply with: stored.',
      enableChrome: false,
    });
    assert.equal(first.exitCode, 0);
    assert.ok(first.sessionId);

    const second = await runClaudeTurn({
      role: 'supervisor',
      cwd: '/tmp',
      prompt: 'What number did I ask you to remember? Reply with just the number.',
      resumeSessionId: first.sessionId!,
      enableChrome: false,
    });
    assert.equal(second.exitCode, 0);
    const text = second.events
      .filter((e) => e.type === 'assistant')
      .map(extractAssistantText)
      .join('');
    assert.match(text, /4242/, `expected resumed session to recall 4242, got: "${text}"`);
  },
);
