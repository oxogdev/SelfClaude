import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamJsonParser,
  extractAssistantText,
  extractSessionId,
  extractToolResults,
  extractToolUses,
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

test('extractToolUses pulls tool_use blocks with id, name, and full input', () => {
  const evt: StreamEvent = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking' },
        {
          type: 'tool_use',
          id: 'tu_01',
          name: 'Bash',
          input: { command: 'pnpm install fastify' },
        },
        {
          type: 'tool_use',
          id: 'tu_02',
          name: 'Read',
          input: { file_path: '/proj/README.md' },
        },
      ],
    },
  } as StreamEvent;
  const uses = extractToolUses(evt);
  assert.equal(uses.length, 2);
  assert.equal(uses[0]!.id, 'tu_01');
  assert.equal(uses[0]!.name, 'Bash');
  assert.equal((uses[0]!.input as { command: string }).command, 'pnpm install fastify');
  assert.equal(uses[1]!.id, 'tu_02');
});

test('extractToolUses returns empty for non-assistant or missing content', () => {
  assert.deepEqual(extractToolUses({ type: 'system' } as StreamEvent), []);
  assert.deepEqual(extractToolUses({ type: 'assistant', message: { role: 'assistant', content: [] } } as StreamEvent), []);
});

test('extractToolUses tolerates malformed blocks (missing id/name)', () => {
  const evt: StreamEvent = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'Bash', input: {} }, // missing id
        { type: 'tool_use', id: 'tu_x' }, // missing name
        { type: 'tool_use', id: 'tu_ok', name: 'Glob', input: { pattern: '**/*.ts' } },
      ],
    },
  } as StreamEvent;
  const uses = extractToolUses(evt);
  assert.equal(uses.length, 1);
  assert.equal(uses[0]!.id, 'tu_ok');
});

test('extractToolResults pairs results with tool_use_id (string content)', () => {
  const evt: StreamEvent = {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_01',
          content: 'added 24 packages',
        },
      ],
    },
  } as StreamEvent;
  const results = extractToolResults(evt);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.toolUseId, 'tu_01');
  assert.equal(results[0]!.text, 'added 24 packages');
  assert.equal(results[0]!.isError, false);
});

test('extractToolResults handles array content (joined text blocks)', () => {
  const evt: StreamEvent = {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_02',
          content: [
            { type: 'text', text: 'line1' },
            { type: 'text', text: 'line2' },
          ],
        },
      ],
    },
  } as StreamEvent;
  const results = extractToolResults(evt);
  assert.equal(results[0]!.text, 'line1\nline2');
});

test('extractToolResults marks isError=true when is_error flag is set', () => {
  const evt: StreamEvent = {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_03',
          content: 'permission denied',
          is_error: true,
        },
      ],
    },
  } as StreamEvent;
  const results = extractToolResults(evt);
  assert.equal(results[0]!.isError, true);
});

test('extractToolResults returns empty for events with no tool_result blocks', () => {
  assert.deepEqual(extractToolResults({ type: 'system' } as StreamEvent), []);
  assert.deepEqual(
    extractToolResults({
      type: 'user',
      message: { content: [{ type: 'text', text: 'hi' }] },
    } as StreamEvent),
    [],
  );
});
