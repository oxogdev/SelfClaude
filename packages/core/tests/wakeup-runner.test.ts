import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WakeupRunner,
  parseScheduleWakeupInput,
  type WakeupEvent,
} from '../src/server/wakeup-runner.js';

function captureEvents(runner: WakeupRunner): {
  events: Array<{ sessionId: string; event: WakeupEvent }>;
  unsubscribe: () => void;
} {
  const events: Array<{ sessionId: string; event: WakeupEvent }> = [];
  const unsubscribe = runner.onEvent((sessionId, event) => events.push({ sessionId, event }));
  return { events, unsubscribe };
}

test('parseScheduleWakeupInput accepts valid shape', () => {
  const out = parseScheduleWakeupInput({
    delaySeconds: 60,
    prompt: 'resume work',
    reason: 'spaced test',
  });
  assert.deepEqual(out, { delaySeconds: 60, prompt: 'resume work', reason: 'spaced test' });
});

test('parseScheduleWakeupInput rejects missing prompt', () => {
  assert.equal(parseScheduleWakeupInput({ delaySeconds: 30 }), null);
});

test('parseScheduleWakeupInput rejects non-positive delay', () => {
  assert.equal(parseScheduleWakeupInput({ delaySeconds: 0, prompt: 'x' }), null);
  assert.equal(parseScheduleWakeupInput({ delaySeconds: -5, prompt: 'x' }), null);
});

test('parseScheduleWakeupInput tolerates missing reason', () => {
  const out = parseScheduleWakeupInput({ delaySeconds: 10, prompt: 'x' });
  assert.equal(out?.reason, '');
});

test('schedule fires the callback after the delay', async () => {
  const runner = new WakeupRunner();
  const { events } = captureEvents(runner);
  let fired = false;

  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 1, prompt: 'go', reason: 'test' },
    async () => {
      fired = true;
    },
  );

  // 1.2s leeway for setTimeout drift.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(fired, true);
  assert.equal(events[0]?.event.kind, 'scheduled');
  assert.equal(events[1]?.event.kind, 'fired');
});

test('schedule replaces an existing wakeup for the same role', async () => {
  const runner = new WakeupRunner();
  const { events } = captureEvents(runner);
  let firstFired = false;
  let secondFired = false;

  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 60, prompt: 'first', reason: '' },
    async () => {
      firstFired = true;
    },
  );
  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 1, prompt: 'second', reason: '' },
    async () => {
      secondFired = true;
    },
  );

  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(firstFired, false);
  assert.equal(secondFired, true);

  const cancelled = events.find((e) => e.event.kind === 'cancelled');
  assert.ok(cancelled, 'expected a cancelled event for the replaced wakeup');
  if (cancelled?.event.kind === 'cancelled') {
    assert.equal(cancelled.event.reason, 'replaced');
  }
});

test('cancel removes a pending wakeup before it fires', async () => {
  const runner = new WakeupRunner();
  const { events } = captureEvents(runner);
  let fired = false;

  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 1, prompt: 'x', reason: '' },
    async () => {
      fired = true;
    },
  );
  runner.cancel('sess-1', 'developer', 'user-input');

  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(fired, false);

  const cancelled = events.find((e) => e.event.kind === 'cancelled');
  assert.ok(cancelled);
  if (cancelled?.event.kind === 'cancelled') {
    assert.equal(cancelled.event.reason, 'user-input');
  }
});

test('sup and dev wakeups are independent', async () => {
  const runner = new WakeupRunner();
  let supFired = false;
  let devFired = false;

  runner.schedule(
    'sess-1',
    'supervisor',
    { delaySeconds: 1, prompt: 'sup', reason: '' },
    async () => {
      supFired = true;
    },
  );
  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 1, prompt: 'dev', reason: '' },
    async () => {
      devFired = true;
    },
  );

  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(supFired, true);
  assert.equal(devFired, true);
});

test('cancelAll clears every role for a session', () => {
  const runner = new WakeupRunner();
  runner.schedule(
    'sess-1',
    'supervisor',
    { delaySeconds: 60, prompt: 'sup', reason: '' },
    async () => {},
  );
  runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 60, prompt: 'dev', reason: '' },
    async () => {},
  );
  assert.equal(runner.list('sess-1').length, 2);
  runner.cancelAll('sess-1');
  assert.equal(runner.list('sess-1').length, 0);
});

test('schedule clamps delaySeconds within [1, 86400]', () => {
  const runner = new WakeupRunner();
  const w = runner.schedule(
    'sess-1',
    'developer',
    { delaySeconds: 999_999_999, prompt: 'x', reason: '' },
    async () => {},
  );
  // 24h max → 86_400s.
  assert.equal(w.fireAt - w.scheduledAt <= 86_400 * 1000, true);
  runner.cancelAll('sess-1');
});
