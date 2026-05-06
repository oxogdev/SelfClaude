import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendItemNote,
  computeConfirmEvidence,
  mergePhaseRegistration,
  phasesPath,
  readPhases,
  writePhases,
  type PhasesFile,
} from '../src/project/phases-store.js';

async function withTempCwd<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-phases-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const empty = (): PhasesFile => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  phases: [],
});

test('readPhases returns empty file when none exists', async () => {
  await withTempCwd(async (cwd) => {
    const f = await readPhases(cwd);
    assert.equal(f.version, 1);
    assert.deepEqual(f.phases, []);
  });
});

test('writePhases + readPhases round-trips', async () => {
  await withTempCwd(async (cwd) => {
    const file: PhasesFile = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      phases: [
        {
          slug: '01-foundation',
          title: 'Phase 01 — Foundation',
          items: [
            {
              id: 'init',
              title: 'Initialize repo',
              status: 'pending',
              proposedBy: null,
              proposedAt: null,
              confirmedBy: null,
              confirmedAt: null,
              notes: '',
              confirmEvidence: null,
              operatorVerifiedAt: null,
              operatorVerifiedBy: null,
            },
          ],
        },
      ],
    };
    await writePhases(cwd, file);
    const read = await readPhases(cwd);
    assert.equal(read.phases.length, 1);
    assert.equal(read.phases[0]!.slug, '01-foundation');
    assert.equal(read.phases[0]!.items.length, 1);
    assert.equal(read.phases[0]!.items[0]!.id, 'init');
  });
});

test('writePhases creates the .selfclaude directory if missing', async () => {
  await withTempCwd(async (cwd) => {
    await writePhases(cwd, empty());
    const path = phasesPath(cwd);
    const read = await readPhases(cwd);
    assert.equal(read.version, 1);
    assert.match(path, /\.selfclaude[\\/]phases\.json$/);
  });
});

test('readPhases gracefully handles corrupt JSON by returning empty file', async () => {
  await withTempCwd(async (cwd) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const path = phasesPath(cwd);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'not-json{{{');
    const read = await readPhases(cwd);
    assert.deepEqual(read.phases, []);
  });
});

test('mergePhaseRegistration creates a new phase when slug is unknown', () => {
  const merged = mergePhaseRegistration(empty(), {
    slug: '01-foundation',
    title: 'Phase 01 — Foundation',
    items: [
      { id: 'init', title: 'Initialize repo' },
      { id: 'config', title: 'Config module' },
    ],
  });
  assert.equal(merged.phases.length, 1);
  assert.equal(merged.phases[0]!.items.length, 2);
  assert.equal(merged.phases[0]!.items[0]!.status, 'pending');
});

test('mergePhaseRegistration preserves status + trail of existing items', () => {
  const initial: PhasesFile = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    phases: [
      {
        slug: '01-foundation',
        title: 'Phase 01',
        items: [
          {
            id: 'init',
            title: 'Initialize repo',
            status: 'done',
            proposedBy: 'developer',
            proposedAt: '2026-01-01T01:00:00.000Z',
            confirmedBy: 'supervisor',
            confirmedAt: '2026-01-01T01:30:00.000Z',
            notes: 'shipped',
              confirmEvidence: null,
              operatorVerifiedAt: null,
              operatorVerifiedBy: null,
          },
        ],
      },
    ],
  };
  const merged = mergePhaseRegistration(initial, {
    slug: '01-foundation',
    title: 'Phase 01 — Foundation (renamed)',
    items: [
      { id: 'init', title: 'Initialize repo (re-titled)' },
      { id: 'config', title: 'Config module' },
    ],
  });
  const items = merged.phases[0]!.items;
  // First item: status preserved, title overwritten with new value.
  assert.equal(items[0]!.status, 'done');
  assert.equal(items[0]!.confirmedBy, 'supervisor');
  assert.equal(items[0]!.notes, 'shipped');
  assert.equal(items[0]!.title, 'Initialize repo (re-titled)');
  // Second item: new, lands as pending.
  assert.equal(items[1]!.status, 'pending');
  assert.equal(items[1]!.id, 'config');
  // Phase title gets the re-registration value.
  assert.equal(merged.phases[0]!.title, 'Phase 01 — Foundation (renamed)');
});

test('mergePhaseRegistration drops items absent from new list', () => {
  const initial: PhasesFile = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    phases: [
      {
        slug: '01-foundation',
        title: 'Phase 01',
        items: [
          {
            id: 'kept',
            title: 'Kept',
            status: 'pending',
            proposedBy: null,
            proposedAt: null,
            confirmedBy: null,
            confirmedAt: null,
            notes: '',
              confirmEvidence: null,
              operatorVerifiedAt: null,
              operatorVerifiedBy: null,
          },
          {
            id: 'dropped',
            title: 'Dropped',
            status: 'done',
            proposedBy: 'developer',
            proposedAt: null,
            confirmedBy: 'supervisor',
            confirmedAt: null,
            notes: '',
              confirmEvidence: null,
              operatorVerifiedAt: null,
              operatorVerifiedBy: null,
          },
        ],
      },
    ],
  };
  const merged = mergePhaseRegistration(initial, {
    slug: '01-foundation',
    title: 'Phase 01',
    items: [{ id: 'kept', title: 'Kept' }],
  });
  assert.equal(merged.phases[0]!.items.length, 1);
  assert.equal(merged.phases[0]!.items[0]!.id, 'kept');
});

test('mergePhaseRegistration leaves other phases untouched', () => {
  const initial: PhasesFile = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    phases: [
      {
        slug: '01-foundation',
        title: 'Phase 01',
        items: [],
      },
      {
        slug: '02-auth',
        title: 'Phase 02',
        items: [
          {
            id: 'jwt',
            title: 'JWT signing',
            status: 'done',
            proposedBy: 'developer',
            proposedAt: null,
            confirmedBy: 'supervisor',
            confirmedAt: null,
            notes: '',
              confirmEvidence: null,
              operatorVerifiedAt: null,
              operatorVerifiedBy: null,
          },
        ],
      },
    ],
  };
  const merged = mergePhaseRegistration(initial, {
    slug: '01-foundation',
    title: 'Phase 01',
    items: [{ id: 'init', title: 'Init' }],
  });
  assert.equal(merged.phases.length, 2);
  const phase02 = merged.phases.find((p) => p.slug === '02-auth')!;
  assert.equal(phase02.items[0]!.status, 'done');
});

test('appendItemNote prefixes a timestamp + actor and skips empty input', () => {
  const out = appendItemNote('', 'developer', 'wrote handler');
  assert.match(out, /^\[\d{4}-\d{2}-\d{2}T.*\] developer: wrote handler$/);
  const out2 = appendItemNote(out, 'supervisor', '   ');
  assert.equal(out2, out, 'whitespace-only note must be a no-op');
  const out3 = appendItemNote(out, 'supervisor', 'looks good');
  assert.equal(out3.split('\n').length, 2);
  assert.match(out3.split('\n')[1]!, /supervisor: looks good$/);
});

/* ───────────── computeConfirmEvidence ───────────── */

test('computeConfirmEvidence buckets reads/bashes/edits in window', () => {
  const log = [
    // Out of window (too old) — must be filtered out.
    { type: 'sup-tool-call', toolUseId: 't0', name: 'Read', input: { file_path: '/old.ts' }, ts: 100 },
    // In window
    { type: 'sup-tool-call', toolUseId: 't1', name: 'Read', input: { file_path: '/src/auth.ts' }, ts: 1500 },
    { type: 'sup-tool-call', toolUseId: 't2', name: 'Bash', input: { command: 'pnpm test auth' }, ts: 1700 },
    { type: 'sup-tool-result', toolUseId: 't2', text: 'ok', isError: false, ts: 1750 },
    { type: 'sup-tool-call', toolUseId: 't3', name: 'Edit', input: { file_path: '/src/auth.ts' }, ts: 1900 },
    // Out of window (too new)
    { type: 'sup-tool-call', toolUseId: 't4', name: 'Read', input: { file_path: '/late.ts' }, ts: 5000 },
  ];
  const ev = computeConfirmEvidence(log, 1000, 2000);
  assert.equal(ev.reads.length, 1);
  assert.equal(ev.reads[0]!.path, '/src/auth.ts');
  assert.equal(ev.bashes.length, 1);
  assert.equal(ev.bashes[0]!.command, 'pnpm test auth');
  assert.equal(ev.bashes[0]!.isError, false);
  assert.equal(ev.edits.length, 1);
  assert.equal(ev.edits[0]!.path, '/src/auth.ts');
  assert.equal(ev.totalCount, 3);
  assert.equal(ev.tsFrom, 1000);
  assert.equal(ev.tsTo, 2000);
});

test('computeConfirmEvidence ignores dev-tool-call entries', () => {
  const log = [
    { type: 'dev-tool-call', toolUseId: 'd1', name: 'Read', input: { file_path: '/x.ts' }, ts: 1500 },
    { type: 'agent-tool-call', agent: 'ui-dev', toolUseId: 'a1', name: 'Read', input: { file_path: '/y.tsx' }, ts: 1500 },
  ];
  const ev = computeConfirmEvidence(log, 1000, 2000);
  assert.equal(ev.totalCount, 0);
});

test('computeConfirmEvidence captures Bash isError from matching result', () => {
  const log = [
    { type: 'sup-tool-call', toolUseId: 't1', name: 'Bash', input: { command: 'pnpm test' }, ts: 1500 },
    { type: 'sup-tool-result', toolUseId: 't1', text: 'fail', isError: true, ts: 1550 },
  ];
  const ev = computeConfirmEvidence(log, 1000, 2000);
  assert.equal(ev.bashes.length, 1);
  assert.equal(ev.bashes[0]!.isError, true);
});

test('computeConfirmEvidence on empty log returns zero-count evidence', () => {
  const ev = computeConfirmEvidence([], 1000, 2000);
  assert.equal(ev.totalCount, 0);
  assert.deepEqual(ev.reads, []);
  assert.deepEqual(ev.bashes, []);
  assert.deepEqual(ev.edits, []);
});

test('computeConfirmEvidence ignores unsupported tool kinds', () => {
  const log = [
    { type: 'sup-tool-call', toolUseId: 't1', name: 'Glob', input: { pattern: '**/*.ts' }, ts: 1500 },
    { type: 'sup-tool-call', toolUseId: 't2', name: 'Grep', input: { pattern: 'foo' }, ts: 1500 },
    { type: 'sup-tool-call', toolUseId: 't3', name: 'ScheduleWakeup', input: {}, ts: 1500 },
  ];
  const ev = computeConfirmEvidence(log, 1000, 2000);
  assert.equal(ev.totalCount, 0);
});
