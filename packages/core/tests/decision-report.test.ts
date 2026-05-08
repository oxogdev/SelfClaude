import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionReportFilename,
  formatDecisionReport,
  type DecisionReportMeta,
} from '../src/server/decision-report.js';
import type { ChatLogEntry } from '../src/project/chat-log.js';

/**
 * Phase 6 sprint 2 — markdown report formatter unit tests.
 * The formatter is pure (chat-log + meta → string), so tests are
 * self-contained — no fs, no orchestrator. We pin one assertion per
 * decision class so a future schema change to chat-log surfaces in
 * the test diff loud and clear.
 */

const meta: DecisionReportMeta = {
  label: 'test-1',
  cwd: '/Users/x/test-1',
  sessionId: '00000000-1111-2222-3333-444444444444',
  generatedAt: 1746000000000,
  firstEntryAt: 1745999000000,
  lastEntryAt: 1746000000000,
};

test('formatDecisionReport: empty chat log produces a report with zero counts', () => {
  const md = formatDecisionReport([], meta);
  assert.match(md, /# Decision report — test-1/);
  assert.match(md, /\*\*0\*\* verdicts/);
  assert.match(md, /\*\*0\*\* phase decisions/);
  assert.match(md, /\*\*0\*\* approval events/);
  assert.match(md, /\*\*0\*\* delegations/);
  assert.match(md, /No decisions recorded for this session/);
});

test('formatDecisionReport: ignores non-decision entries (text, tool calls)', () => {
  const log: ChatLogEntry[] = [
    { type: 'user-message', text: 'hello', ts: 1 },
    { type: 'sup-message', text: 'hi', ts: 2 },
    {
      type: 'dev-tool-call',
      id: 'a',
      toolUseId: 'b',
      name: 'Edit',
      input: {},
      ts: 3,
    },
    { type: 'turn-marker', turnIndex: 1, who: 'sup', ts: 4 },
  ];
  const md = formatDecisionReport(log, meta);
  // No decision-class entries → trail is empty.
  assert.match(md, /No decisions recorded/);
});

test('formatDecisionReport: verdict entry renders with id + body', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'verdict',
      id: 3,
      text: 'All admin endpoints must require operator-only auth.',
      ts: 1746000005000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /\*\*1\*\* verdict\b/);
  assert.match(md, /Verdict #003/);
  assert.match(md, /All admin endpoints must require operator-only auth\./);
});

test('formatDecisionReport: phase-doc-written renders the filename inline', () => {
  const log: ChatLogEntry[] = [
    { type: 'phase-doc-written', filename: '01-foundation.md', ts: 1746000010000 },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /\*\*1\*\* phase decision\b/);
  assert.match(md, /Phase doc written/);
  assert.match(md, /`01-foundation\.md`/);
});

test('formatDecisionReport: phase-item-confirmed includes evidence count', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'phase-item-confirmed',
      slug: '01-readme',
      itemId: 'readme',
      itemTitle: 'README delivered',
      confirmer: 'supervisor',
      proposer: 'developer',
      evidence: {
        reads: [{ path: 'README.md', ts: 1746000000001 }],
        bashes: [],
        edits: [],
        tsFrom: 1746000000000,
        tsTo: 1746000000005,
        totalCount: 2,
      },
      notes: 'verified by Read',
      ts: 1746000000006,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /Confirmed:.*`01-readme\/readme`/);
  assert.match(md, /README delivered/);
  assert.match(md, /2 verification calls/);
  // Notes get blockquoted.
  assert.match(md, /> verified by Read/);
});

test('formatDecisionReport: phase-item-rejected emits the reason', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'phase-item-rejected',
      slug: '01-foo',
      itemId: 'thing',
      itemTitle: 'Build thing',
      rejector: 'supervisor',
      proposer: 'developer',
      reason: 'Missing the smoke test that proves it boots.',
      ts: 1746000020000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /Rejected:.*`01-foo\/thing`/);
  assert.match(md, /> Missing the smoke test/);
});

test('formatDecisionReport: approval pair renders both sides', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'approval',
      id: 'approval-id-12345678',
      action: 'rm -rf src/legacy/',
      reason: 'Removing the dead vendor folder before refactor.',
      ts: 1746000030000,
    },
    {
      type: 'approval-resolved',
      id: 'approval-id-12345678',
      decision: 'allow',
      ts: 1746000031000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /\*\*2\*\* approval events/);
  assert.match(md, /Approval requested/);
  assert.match(md, /\*\*Action:\*\* rm -rf src\/legacy\//);
  assert.match(md, /Approved \(request `approval/);
});

test('formatDecisionReport: denial uses the right verb', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'approval-resolved',
      id: 'denied-id-abc',
      decision: 'deny',
      ts: 1746000040000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /Denied \(request/);
});

test('formatDecisionReport: task-marker emits delegation summary', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'task-marker',
      summary: 'add /health endpoint to src/server/index.ts',
      ts: 1746000050000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  assert.match(md, /\*\*1\*\* delegation\b/);
  assert.match(md, /Delegated/);
  assert.match(md, /add \/health endpoint/);
});

test('formatDecisionReport: emits entries in chronological order', () => {
  const log: ChatLogEntry[] = [
    {
      type: 'verdict',
      id: 1,
      text: 'first decision',
      ts: 1000,
    },
    {
      type: 'task-marker',
      summary: 'second event',
      ts: 2000,
    },
    {
      type: 'verdict',
      id: 2,
      text: 'third decision',
      ts: 3000,
    },
  ];
  const md = formatDecisionReport(log, meta);
  const firstIdx = md.indexOf('first decision');
  const secondIdx = md.indexOf('second event');
  const thirdIdx = md.indexOf('third decision');
  assert.ok(firstIdx > 0 && firstIdx < secondIdx, 'first must come before second');
  assert.ok(secondIdx < thirdIdx, 'second must come before third');
});

test('decisionReportFilename: produces slug-safe ASCII filename', () => {
  const f = decisionReportFilename({
    ...meta,
    label: 'My Project /// 2026',
  });
  assert.match(f, /^decision-report-/);
  assert.match(f, /\.md$/);
  // Slashes + spaces replaced by hyphens.
  assert.equal(f.includes(' '), false);
  assert.equal(f.includes('/'), false);
});

test('decisionReportFilename: empty label falls back to "session"', () => {
  const f = decisionReportFilename({ ...meta, label: '!!!' });
  assert.match(f, /session/);
});

test('decisionReportFilename: includes generated date', () => {
  const f = decisionReportFilename({
    ...meta,
    generatedAt: new Date('2026-05-08T12:00:00Z').getTime(),
  });
  assert.match(f, /-2026-05-08\.md$/);
});
