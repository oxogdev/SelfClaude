import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from '../src/orchestrator/index.js';
import { TelegramBridge } from '../src/telegram/bridge.js';
import type { IncomingMessage, TelegramAdapter } from '../src/telegram/adapter.js';

class FakeTelegramAdapter implements TelegramAdapter {
  readonly sent: { text: string; messageId: number }[] = [];
  private handler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private nextId = 1;

  async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    this.handler = onMessage;
  }
  async stop(): Promise<void> {
    this.handler = null;
  }
  async send(text: string): Promise<number> {
    const messageId = this.nextId++;
    this.sent.push({ text, messageId });
    return messageId;
  }
  async simulateIncoming(msg: IncomingMessage): Promise<void> {
    if (!this.handler) throw new Error('adapter not started');
    await this.handler(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('bridge does not escalate if the question is resolved before the timeout', async () => {
  const orch = new Orchestrator({ cwd: '/tmp/sc-bridge-test-1' });
  const adapter = new FakeTelegramAdapter();
  const bridge = new TelegramBridge({
    orchestrator: orch,
    adapter,
    escalationDelayMs: 60,
  });
  await bridge.start();
  try {
    const askPromise = orch.askUser({ role: 'supervisor', question: 'q?', urgency: 'low' });
    // Resolve immediately via the on-screen path
    const pending = orch.listPendingQuestions();
    assert.equal(pending.length, 1);
    orch.resolveUserQuestion(pending[0]!.id, 'fast-answer');

    const result = await askPromise;
    assert.equal(result.answer, 'fast-answer');

    // Wait past the escalation delay; nothing should have been sent
    await sleep(120);
    assert.equal(adapter.sent.length, 0, `expected no Telegram send; got ${JSON.stringify(adapter.sent)}`);
  } finally {
    await bridge.stop();
  }
});

test('bridge escalates after the timeout and routes the reply back to the orchestrator', async () => {
  const orch = new Orchestrator({ cwd: '/tmp/sc-bridge-test-2' });
  const adapter = new FakeTelegramAdapter();
  const bridge = new TelegramBridge({
    orchestrator: orch,
    adapter,
    escalationDelayMs: 30,
  });
  await bridge.start();
  try {
    const askPromise = orch.askUser({ role: 'supervisor', question: 'pick', urgency: 'low' });

    // Wait past escalation delay
    await sleep(80);
    assert.equal(adapter.sent.length, 1, 'expected one escalation send');
    assert.match(adapter.sent[0]!.text, /pick/);

    // Simulate user replying on Telegram
    await adapter.simulateIncoming({
      text: 'option-2',
      replyToMessageId: adapter.sent[0]!.messageId,
    });

    const result = await askPromise;
    assert.equal(result.answer, 'option-2');
  } finally {
    await bridge.stop();
  }
});

test('bridge escalates approval requests and parses yes/no replies', async () => {
  const orch = new Orchestrator({ cwd: '/tmp/sc-bridge-test-3' });
  const adapter = new FakeTelegramAdapter();
  const bridge = new TelegramBridge({
    orchestrator: orch,
    adapter,
    escalationDelayMs: 30,
  });
  await bridge.start();
  try {
    const reqPromise = orch.requestApproval({
      role: 'developer',
      toolName: 'Bash',
      action: 'Bash: rm -rf /tmp/x',
      reason: 'recursive rm',
      summary: 'rm -rf /tmp/x',
      origin: 'pre-tool-use',
    });

    await sleep(80);
    assert.equal(adapter.sent.length, 1);
    assert.match(adapter.sent[0]!.text, /rm -rf/);

    await adapter.simulateIncoming({
      text: 'no, blocked',
      replyToMessageId: adapter.sent[0]!.messageId,
    });

    const result = await reqPromise;
    assert.equal(result.decision, 'deny');
  } finally {
    await bridge.stop();
  }
});

test('bridge falls back to most-recent escalation when reply has no replyToMessageId', async () => {
  const orch = new Orchestrator({ cwd: '/tmp/sc-bridge-test-4' });
  const adapter = new FakeTelegramAdapter();
  const bridge = new TelegramBridge({
    orchestrator: orch,
    adapter,
    escalationDelayMs: 20,
  });
  await bridge.start();
  try {
    const askPromise = orch.askUser({ role: 'supervisor', question: 'last?', urgency: 'low' });
    await sleep(60);
    assert.equal(adapter.sent.length, 1);

    // Simulate plain (non-reply) message
    await adapter.simulateIncoming({ text: 'plain answer' });

    const result = await askPromise;
    assert.equal(result.answer, 'plain answer');
  } finally {
    await bridge.stop();
  }
});

test('bridge.stop tears down pending timers without firing them', async () => {
  const orch = new Orchestrator({ cwd: '/tmp/sc-bridge-test-5' });
  const adapter = new FakeTelegramAdapter();
  const bridge = new TelegramBridge({
    orchestrator: orch,
    adapter,
    escalationDelayMs: 60,
  });
  await bridge.start();
  // Create a pending question whose timer is armed
  orch.askUser({ role: 'supervisor', question: 'late?', urgency: 'low' }).catch(() => undefined);
  await bridge.stop();
  // Wait past what would have been the delay
  await sleep(120);
  assert.equal(adapter.sent.length, 0, `expected no send after stop; got ${JSON.stringify(adapter.sent)}`);
});
