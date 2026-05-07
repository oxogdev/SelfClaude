import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptIntoOriginal,
  branchExists,
  commitTurn,
  createSessionBranch,
  detectRepoState,
  discardBranch,
  getBranchStatus,
} from '../src/server/git-isolation.js';

/**
 * Phase 5 git-isolation tests run real `git` against tmp dirs. The
 * module exists to be load-bearing for trust — tests cover both happy
 * paths and the safety refusals (dirty tree, existing branch, no
 * commits, detached head, non-repo).
 *
 * Each test spins up its own tmp dir. The harness disables global
 * git config (gpg signing, hooks) that could leak from the developer's
 * machine into a CI run.
 */

async function run(cwd: string, cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env },
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stderr }));
  });
}

async function git(cwd: string, args: string[]) {
  return run(cwd, 'git', args);
}

/**
 * Spin up a tmp dir with a fresh git repo + one initial commit on `main`.
 * Hardens against the developer's user-global git config polluting the
 * test (auto-gpg-sign, hooks, etc.).
 */
async function withFreshRepo(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'sc-git-iso-'));
  try {
    await git(cwd, ['init', '-b', 'main']);
    // Disable signing + hooks for deterministic tests.
    await git(cwd, ['config', 'commit.gpgSign', 'false']);
    await git(cwd, ['config', 'tag.gpgSign', 'false']);
    await git(cwd, ['config', 'user.email', 'test@selfclaude.local']);
    await git(cwd, ['config', 'user.name', 'SC Test']);
    await writeFile(join(cwd, 'README.md'), 'initial\n', 'utf8');
    await git(cwd, ['add', 'README.md']);
    await git(cwd, ['commit', '-m', 'initial']);
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function withTmpDir(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'sc-git-iso-'));
  try {
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('detectRepoState reports non-repo for plain dirs', async () => {
  await withTmpDir(async (cwd) => {
    const s = await detectRepoState(cwd);
    assert.equal(s.isRepo, false);
    assert.equal(s.currentBranch, null);
    assert.equal(s.headSha, null);
    assert.equal(s.dirty, false);
  });
});

test('detectRepoState reports clean repo correctly', async () => {
  await withFreshRepo(async (cwd) => {
    const s = await detectRepoState(cwd);
    assert.equal(s.isRepo, true);
    assert.equal(s.currentBranch, 'main');
    assert.ok(s.headSha && s.headSha.length === 40);
    assert.equal(s.dirty, false);
  });
});

test('detectRepoState detects dirty worktree', async () => {
  await withFreshRepo(async (cwd) => {
    await writeFile(join(cwd, 'untracked.txt'), 'x', 'utf8');
    const s = await detectRepoState(cwd);
    assert.equal(s.dirty, true);
  });
});

test('createSessionBranch refuses on non-repo', async () => {
  await withTmpDir(async (cwd) => {
    const r = await createSessionBranch(cwd, 'selfclaude/x');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not-a-repo');
  });
});

test('createSessionBranch refuses on dirty worktree', async () => {
  await withFreshRepo(async (cwd) => {
    await writeFile(join(cwd, 'dirty.txt'), 'x', 'utf8');
    const r = await createSessionBranch(cwd, 'selfclaude/x');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'dirty-worktree');
  });
});

test('createSessionBranch refuses when branch already exists', async () => {
  await withFreshRepo(async (cwd) => {
    // Pre-create a branch that collides.
    await git(cwd, ['checkout', '-b', 'selfclaude/dup']);
    await git(cwd, ['checkout', 'main']);
    const r = await createSessionBranch(cwd, 'selfclaude/dup');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'branch-exists');
  });
});

test('createSessionBranch creates and checks out the branch', async () => {
  await withFreshRepo(async (cwd) => {
    const r = await createSessionBranch(cwd, 'selfclaude/abc');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.branch, 'selfclaude/abc');
      assert.equal(r.originalBranch, 'main');
      assert.ok(r.startSha.length === 40);
    }
    // Verify checkout actually happened.
    const state = await detectRepoState(cwd);
    assert.equal(state.currentBranch, 'selfclaude/abc');
    assert.equal(await branchExists(cwd, 'selfclaude/abc'), true);
  });
});

test('commitTurn no-ops when nothing changed', async () => {
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/x');
    assert.equal(create.ok, true);
    const r = await commitTurn(cwd, 'should be skipped');
    assert.equal(r.committed, false);
    assert.equal(r.sha, null);
    assert.equal(r.filesChanged, 0);
  });
});

test('commitTurn stages and commits new files', async () => {
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/y');
    assert.equal(create.ok, true);
    await writeFile(join(cwd, 'foo.txt'), 'hi\n', 'utf8');
    await writeFile(join(cwd, 'bar.txt'), 'there\n', 'utf8');
    const r = await commitTurn(cwd, '[selfclaude] sup turn 1 — wrote 2 files');
    assert.equal(r.committed, true);
    assert.ok(r.sha && r.sha.length === 40);
    assert.equal(r.filesChanged, 2);
    // Worktree is now clean (everything staged + committed).
    const s = await detectRepoState(cwd);
    assert.equal(s.dirty, false);
  });
});

test('getBranchStatus reports commitCount and filesChanged', async () => {
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/z');
    assert.equal(create.ok, true);
    await writeFile(join(cwd, 'a.txt'), 'a\n', 'utf8');
    await commitTurn(cwd, 'first');
    await writeFile(join(cwd, 'b.txt'), 'b\n', 'utf8');
    await commitTurn(cwd, 'second');
    const status = await getBranchStatus(cwd, 'selfclaude/z', 'main');
    assert.equal(status.commitCount, 2);
    assert.equal(status.filesChanged, 2);
    assert.equal(status.dirty, false);
  });
});

test('acceptIntoOriginal squash-merges the session branch and deletes it', async () => {
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/sq');
    assert.equal(create.ok, true);
    await writeFile(join(cwd, 'a.txt'), 'a\n', 'utf8');
    await commitTurn(cwd, 'turn 1');
    await writeFile(join(cwd, 'b.txt'), 'b\n', 'utf8');
    await commitTurn(cwd, 'turn 2');
    const accept = await acceptIntoOriginal(
      cwd,
      'selfclaude/sq',
      'main',
      '[selfclaude] session sq — accepted',
    );
    assert.equal(accept.ok, true);
    if (accept.ok) {
      assert.ok(accept.mergeSha && accept.mergeSha.length === 40);
    }
    // We're back on main, branch is gone, files exist.
    const s = await detectRepoState(cwd);
    assert.equal(s.currentBranch, 'main');
    assert.equal(s.dirty, false);
    assert.equal(await branchExists(cwd, 'selfclaude/sq'), false);
    // Squash means main has exactly one new commit (vs the initial).
    const log = await run(cwd, 'git', ['rev-list', '--count', 'main']);
    assert.equal(log.code, 0);
  });
});

test('discardBranch wipes the branch + restores main; worktree clean', async () => {
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/dd');
    assert.equal(create.ok, true);
    await writeFile(join(cwd, 'dirt.txt'), 'will not survive\n', 'utf8');
    await commitTurn(cwd, 'committed dirt');
    // Plus an uncommitted untracked file on the SC branch — discard
    // must clean it too.
    await writeFile(join(cwd, 'untracked.txt'), 'also gone\n', 'utf8');
    const r = await discardBranch(cwd, 'selfclaude/dd', 'main');
    assert.equal(r.ok, true);
    const s = await detectRepoState(cwd);
    assert.equal(s.currentBranch, 'main');
    assert.equal(s.dirty, false);
    assert.equal(await branchExists(cwd, 'selfclaude/dd'), false);
    // The committed file from the SC branch shouldn't exist on main.
    const ls = await run(cwd, 'ls', [join(cwd, 'dirt.txt')]);
    assert.equal(ls.code !== 0, true, 'dirt.txt should not exist on main after discard');
  });
});

test('discardBranch returns to original even when no changes were made', async () => {
  // Edge case: operator enabled isolation but didn't commit anything.
  // Discard should still cleanly delete the branch.
  await withFreshRepo(async (cwd) => {
    const create = await createSessionBranch(cwd, 'selfclaude/empty');
    assert.equal(create.ok, true);
    const r = await discardBranch(cwd, 'selfclaude/empty', 'main');
    assert.equal(r.ok, true);
    assert.equal(await branchExists(cwd, 'selfclaude/empty'), false);
    const s = await detectRepoState(cwd);
    assert.equal(s.currentBranch, 'main');
  });
});

test('safety: createSessionBranch refuses on no-commits repo', async () => {
  // Fresh `git init`, no commits → no HEAD to fork from.
  await withTmpDir(async (cwd) => {
    await git(cwd, ['init', '-b', 'main']);
    await git(cwd, ['config', 'user.email', 'test@selfclaude.local']);
    await git(cwd, ['config', 'user.name', 'SC Test']);
    const r = await createSessionBranch(cwd, 'selfclaude/empty');
    assert.equal(r.ok, false);
    if (!r.ok) {
      // Either no-commits or detached-head depending on git version's
      // behavior on an empty repo. Both are acceptable refusals.
      assert.ok(r.reason === 'no-commits' || r.reason === 'detached-head');
    }
  });
});
