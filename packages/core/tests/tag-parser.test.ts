import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDeveloperTasks } from '../src/orchestrator/tag-parser.js';

test('extracts a single TASK_FOR_DEVELOPER block and trims it', () => {
  const r = extractDeveloperTasks(
    'Plan: do X.\n<TASK_FOR_DEVELOPER>  Read README.md and report.  </TASK_FOR_DEVELOPER>\nThanks.',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'Read README.md and report.', parallel: false },
  ]);
  assert.equal(r.remainingText, 'Plan: do X.\n\nThanks.');
});

test('extracts multiple sequential blocks', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>step 1</TASK_FOR_DEVELOPER>\n<TASK_FOR_DEVELOPER>step 2</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'step 1', parallel: false },
    { agent: 'developer', body: 'step 2', parallel: false },
  ]);
});

test('preserves multi-line task bodies', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>\nline 1\nline 2\n</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'line 1\nline 2', parallel: false },
  ]);
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
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'a', parallel: false },
    { agent: 'developer', body: 'b', parallel: false },
  ]);
});

test('collapses runs of blank lines left by tag removal', () => {
  const r = extractDeveloperTasks(
    'Header\n\n<TASK_FOR_DEVELOPER>x</TASK_FOR_DEVELOPER>\n\n\nFooter',
  );
  assert.equal(r.remainingText, 'Header\n\nFooter');
});

test('routes tasks with explicit agent attribute', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER agent="ui-dev">build the dashboard</TASK_FOR_DEVELOPER>\n' +
      '<TASK_FOR_DEVELOPER agent="security">audit the auth flow</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'ui-dev', body: 'build the dashboard', parallel: false },
    { agent: 'security', body: 'audit the auth flow', parallel: false },
  ]);
});

test('mixes default and explicit-agent tasks in the same message', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER>migrate schema</TASK_FOR_DEVELOPER>\n' +
      '<TASK_FOR_DEVELOPER agent="ui-dev">wire login form</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'migrate schema', parallel: false },
    { agent: 'ui-dev', body: 'wire login form', parallel: false },
  ]);
});

test('parses SUMMON / DISMISS lifecycle tags and strips them from text', () => {
  const r = extractDeveloperTasks(
    'Bringing the UI dev online for the next phase.\n' +
      '<SUMMON agent="ui-dev"/>\nLet\'s start designing.',
  );
  assert.deepEqual(r.summonedAgents, ['ui-dev']);
  assert.deepEqual(r.dismissedAgents, []);
  assert.match(r.remainingText, /Bringing the UI dev online/);
  assert.doesNotMatch(r.remainingText, /<SUMMON/);
});

test('SUMMON without self-closing slash also works', () => {
  const r = extractDeveloperTasks('<SUMMON agent="security">');
  assert.deepEqual(r.summonedAgents, ['security']);
});

test('DISMISS deduplicates repeated mentions', () => {
  const r = extractDeveloperTasks(
    '<DISMISS agent="ui-dev"/><DISMISS agent="ui-dev"/>',
  );
  assert.deepEqual(r.dismissedAgents, ['ui-dev']);
});

test('parses parallel="true" attribute', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER agent="ui-dev" parallel="true">build the dashboard</TASK_FOR_DEVELOPER>\n' +
      '<TASK_FOR_DEVELOPER agent="security" parallel="true">audit the auth flow</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'ui-dev', body: 'build the dashboard', parallel: true },
    { agent: 'security', body: 'audit the auth flow', parallel: true },
  ]);
});

test('parallel attribute order is permissive (parallel first, agent second)', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER parallel="true" agent="ui-dev">design login</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'ui-dev', body: 'design login', parallel: true },
  ]);
});

test('parallel="false" or non-true value is treated as serial', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER agent="developer" parallel="false">migrate schema</TASK_FOR_DEVELOPER>\n' +
      '<TASK_FOR_DEVELOPER agent="ui-dev" parallel="maybe">wire form</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'developer', body: 'migrate schema', parallel: false },
    { agent: 'ui-dev', body: 'wire form', parallel: false },
  ]);
});

test('default parallel is false when attribute absent', () => {
  const r = extractDeveloperTasks(
    '<TASK_FOR_DEVELOPER agent="ui-dev">do thing</TASK_FOR_DEVELOPER>',
  );
  assert.deepEqual(r.tasks, [
    { agent: 'ui-dev', body: 'do thing', parallel: false },
  ]);
});
