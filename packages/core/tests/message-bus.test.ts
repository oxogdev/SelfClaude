import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageBus, type InboxMessage } from '../src/orchestrator/message-bus.js';

test('enqueue assigns id and timestamp', () => {
  const bus = new MessageBus();
  const m = bus.enqueue({ to: 'developer', source: 'supervisor', body: 'hello' });
  assert.ok(m.id);
  assert.ok(m.ts > 0);
  assert.equal(m.body, 'hello');
  assert.equal(m.to, 'developer');
});

test('drain returns and clears queue', () => {
  const bus = new MessageBus();
  bus.enqueue({ to: 'developer', source: 'supervisor', body: 'a' });
  bus.enqueue({ to: 'developer', source: 'supervisor', body: 'b' });
  const drained = bus.drain('developer');
  assert.equal(drained.length, 2);
  assert.equal(bus.size('developer'), 0);
  assert.equal(bus.drain('developer').length, 0);
});

test('queues are isolated by inbox', () => {
  const bus = new MessageBus();
  bus.enqueue({ to: 'developer', source: 'supervisor', body: 'for-dev' });
  bus.enqueue({ to: 'supervisor', source: 'developer', body: 'for-sup' });
  assert.equal(bus.size('developer'), 1);
  assert.equal(bus.size('supervisor'), 1);
  assert.equal(bus.drain('developer')[0]!.body, 'for-dev');
  assert.equal(bus.drain('supervisor')[0]!.body, 'for-sup');
});

test('emits enqueued and drained events', () => {
  const bus = new MessageBus();
  const enqueued: InboxMessage[] = [];
  const drained: { target: string; count: number }[] = [];
  bus.on('enqueued', (m) => enqueued.push(m as InboxMessage));
  bus.on('drained', (target: string, count: number) => drained.push({ target, count }));
  bus.enqueue({ to: 'developer', source: 'supervisor', body: 'x' });
  bus.drain('developer');
  assert.equal(enqueued.length, 1);
  assert.deepEqual(drained, [{ target: 'developer', count: 1 }]);
});

test('peek returns a copy without draining', () => {
  const bus = new MessageBus();
  bus.enqueue({ to: 'supervisor', source: 'orchestrator', body: 'x' });
  const peeked = bus.peek('supervisor');
  assert.equal(peeked.length, 1);
  assert.equal(bus.size('supervisor'), 1);
});

test('drain on empty queue does not emit drained event', () => {
  const bus = new MessageBus();
  let emitted = false;
  bus.on('drained', () => {
    emitted = true;
  });
  bus.drain('developer');
  assert.equal(emitted, false);
});
