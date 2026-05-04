import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatApproval, formatQuestion } from '../src/telegram/formatter.js';

test('formatQuestion includes role, urgency mark, and question text', () => {
  const t = formatQuestion({
    id: 'q1',
    role: 'supervisor',
    question: 'Switch DB to Postgres?',
    urgency: 'low',
  });
  assert.match(t, /Question from supervisor/);
  assert.match(t, /Switch DB to Postgres\?/);
  assert.match(t, /Reply to this message/);
});

test('formatQuestion uses ❗ for high-urgency questions', () => {
  const t = formatQuestion({
    id: 'q1',
    role: 'supervisor',
    question: 'Production deploy now?',
    urgency: 'high',
  });
  assert.match(t, /❗/);
});

test('formatQuestion lists numbered options when present', () => {
  const t = formatQuestion({
    id: 'q1',
    role: 'supervisor',
    question: 'Pick a flavor',
    options: ['vanilla', 'chocolate'],
    urgency: 'low',
  });
  assert.match(t, /1\. vanilla/);
  assert.match(t, /2\. chocolate/);
});

test('formatApproval includes action, reason, and reply hint', () => {
  const t = formatApproval({
    id: 'a1',
    role: 'developer',
    toolName: 'Bash',
    action: 'Bash: rm -rf /tmp/x',
    summary: 'rm -rf /tmp/x',
    reason: 'recursive/forced rm',
    origin: 'pre-tool-use',
  });
  assert.match(t, /Approval requested/);
  assert.match(t, /Bash: rm -rf/);
  assert.match(t, /recursive\/forced rm/);
  assert.match(t, /yes.*allow/);
});

test('formatApproval uses ⚠️ for pre-tool-use origin and 🔐 for mcp origin', () => {
  const pre = formatApproval({
    id: 'a',
    role: 'developer',
    toolName: 'Bash',
    action: 'X',
    summary: 'X',
    reason: 'r',
    origin: 'pre-tool-use',
  });
  const mcp = formatApproval({
    id: 'a',
    role: 'supervisor',
    toolName: null,
    action: 'X',
    summary: 'X',
    reason: 'r',
    origin: 'mcp',
  });
  assert.match(pre, /⚠️/);
  assert.match(mcp, /🔐/);
});
