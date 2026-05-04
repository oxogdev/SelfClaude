import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamJsonParser,
  extractAssistantText,
  extractSessionId,
  type StreamEvent,
} from '../src/orchestrator/stream-parser.js';

test('parses a single event ending with newline', () => {
  const p = new StreamJsonParser();
  const evts = p.feed('{"type":"system","session_id":"abc"}\n');
  assert.equal(evts.length, 1);
  assert.equal(evts[0]!.type, 'system');
  assert.equal(extractSessionId(evts[0]!), 'abc');
});

test('reassembles a chunk split across newline boundary', () => {
  const p = new StreamJsonParser();
  let evts = p.feed('{"type":"system",');
  assert.equal(evts.length, 0);
  evts = p.feed('"session_id":"xyz"}\n');
  assert.equal(evts.length, 1);
  assert.equal(extractSessionId(evts[0]!), 'xyz');
});

test('parses multiple events in a single chunk', () => {
  const p = new StreamJsonParser();
  const evts = p.feed('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n');
  assert.deepEqual(
    evts.map((e) => e.type),
    ['a', 'b', 'c'],
  );
});

test('skips empty lines without errors', () => {
  const p = new StreamJsonParser();
  const evts = p.feed('\n\n{"type":"a"}\n\n');
  assert.equal(evts.length, 1);
  assert.equal(p.getErrors().length, 0);
});

test('records parse errors and continues with subsequent valid lines', () => {
  const p = new StreamJsonParser();
  const evts = p.feed('not-json\n{"type":"ok"}\n');
  assert.equal(evts.length, 1);
  assert.equal(evts[0]!.type, 'ok');
  assert.equal(p.getErrors().length, 1);
});

test('flush returns a remainder line as an event when valid', () => {
  const p = new StreamJsonParser();
  p.feed('{"type":"');
  p.feed('done"}');
  const flushed = p.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]!.type, 'done');
});

test('flush drops malformed remainder', () => {
  const p = new StreamJsonParser();
  p.feed('{"type":"partial');
  const flushed = p.flush();
  assert.equal(flushed.length, 0);
  assert.equal(p.getErrors().length, 1);
});

test('extractAssistantText concatenates text blocks and ignores other content types', () => {
  const evt: StreamEvent = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', id: '1', name: 'X', input: {} },
        { type: 'text', text: 'world' },
      ],
    },
  } as StreamEvent;
  assert.equal(extractAssistantText(evt), 'hello world');
});

test('extractAssistantText returns empty string for non-assistant events', () => {
  assert.equal(extractAssistantText({ type: 'system' } as StreamEvent), '');
  assert.equal(extractAssistantText({ type: 'result' } as StreamEvent), '');
});

test('extractSessionId returns null when absent', () => {
  assert.equal(extractSessionId({ type: 'noop' } as StreamEvent), null);
});
