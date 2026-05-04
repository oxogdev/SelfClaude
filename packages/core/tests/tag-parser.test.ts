import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDeveloperTasks } from '../src/orchestrator/tag-parser.js';

test('extracts a single TASK_FOR_DEVELOPER block and trims it', () => {
  const r = extractDeveloperTasks(
    'Plan: do X.\n<TASK_FOR_DEVELOPER>  Read README.md and report.  </TASK_FOR_DEVELOPER>\nThanks.',
  );
  assert.deepEqual(r.tasks, ['Read README.md and report.']);
  assert.equal(r.remainingText, 'Plan: do X.\n\nThanks.');
});

test('extracts multiple sequential blocks', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>step 1</TASK_FOR_DEVELOPER>\n<TASK_FOR_DEVELOPER>step 2</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, ['step 1', 'step 2']);
});

test('preserves multi-line task bodies', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>\nline 1\nline 2\n</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, ['line 1\nline 2']);
});

test('returns no tasks and original text when no tags present', () => {
  const r = extractDeveloperTasks('Just a plain message.');
  assert.deepEqual(r.tasks, []);
  assert.equal(r.remainingText, 'Just a plain message.');
});

test('skips whitespace-only tag bodies', () => {
  const r = extractDeveloperTasks('<TASK_FOR_DEVELOPER>   </TASK_FOR_DEVELOPER>');
  assert.deepEqual(r.tasks, []);
});

test('non-greedy match across adjacent tags', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>a</TASK_FOR_DEVELOPER><TASK_FOR_DEVELOPER>b</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, ['a', 'b']);
});

test('collapses runs of blank lines left by tag removal', () => {
  const r = extractDeveloperTasks(
    'Header\n\n<TASK_FOR_DEVELOPER>x</TASK_FOR_DEVELOPER>\n\n\nFooter',
  );
  assert.equal(r.remainingText, 'Header\n\nFooter');
});
