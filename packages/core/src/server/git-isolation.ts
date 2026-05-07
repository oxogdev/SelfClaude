import { spawn } from 'node:child_process';

/**
 * Phase 5 of ROADMAP.md (Trust v1) — git branch isolation primitives.
 *
 * Every operation in this module shells out to the host's `git` binary
 * via `git -C <cwd> <subcommand>`. We never modify process cwd; every
 * call carries the workspace path explicitly so concurrent sessions in
 * different projects can't trample each other.
 *
 * **Safety contract** (load-bearing — these rules are why operators
 * can trust SelfClaude with their real repo):
 *
 *   1. NEVER push. Phase 5 is local-only — `git push` is never run.
 *   2. NEVER overwrite an existing branch. Branch creation refuses
 *      when the target name already exists.
 *   3. NEVER force-anything (`-f`, `-D` only when the branch we are
 *      deleting is one WE created and the caller asked us to discard).
 *   4. NEVER act on a dirty tree. Branch creation refuses when the
 *      worktree has uncommitted changes; auto-stashing is risky and
 *      we explicitly do not do it.
 *   5. NEVER touch a detached HEAD. Branch creation requires a real
 *      symbolic ref so we know what to merge back into on accept.
 *   6. NEVER modify branches the operator created. Discard/accept
 *      operate strictly on the SelfClaude session branch passed in.
 *
 * Per ROADMAP calibration #5: hybrid commit cadence — granular per
 * turn during work, squash on accept by default. The squash is what
 * lands on the operator's working branch; the per-turn detail lives
 * on the session branch for debugging until accept (when it's
 * collapsed) or discard (when the whole branch evaporates).
 */

/* ───── Low-level git runner ───── */

export interface GitResult {
  /** Captured stdout (trimmed). */
  stdout: string;
  /** Captured stderr (trimmed). */
  stderr: string;
  /** Exit code; 0 = success. */
  code: number;
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Inherit env so the operator's git config (user.name/email, GPG) applies.
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });
  });
}

/* ───── Repo detection + state ───── */

export interface RepoState {
  /** Workspace is inside a git work tree. */
  isRepo: boolean;
  /** Current branch name. `null` when detached HEAD or non-repo. */
  currentBranch: string | null;
  /** SHA of HEAD. `null` when no commits yet (fresh `git init`) or non-repo. */
  headSha: string | null;
  /** True when `git status --porcelain` reports any uncommitted changes. */
  dirty: boolean;
}

export async function detectRepoState(cwd: string): Promise<RepoState> {
  const probe = await runGit(cwd, ['rev-parse', '--git-dir']);
  if (probe.code !== 0) {
    return { isRepo: false, currentBranch: null, headSha: null, dirty: false };
  }
  // Symbolic-ref returns non-zero on detached HEAD; that's fine, we
  // map it to currentBranch=null below.
  const branchProbe = await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const currentBranch = branchProbe.code === 0 && branchProbe.stdout ? branchProbe.stdout : null;
  const shaProbe = await runGit(cwd, ['rev-parse', '-q', '--verify', 'HEAD']);
  const headSha = shaProbe.code === 0 && shaProbe.stdout ? shaProbe.stdout : null;
  const statusProbe = await runGit(cwd, ['status', '--porcelain']);
  const dirty = statusProbe.code === 0 && statusProbe.stdout.length > 0;
  return { isRepo: true, currentBranch, headSha, dirty };
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const r = await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.code === 0;
}

/* ───── Session branch lifecycle ───── */

export interface CreateBranchOk {
  ok: true;
  /** The branch we created and checked out. */
  branch: string;
  /** The branch we forked from, captured for later accept/discard. */
  originalBranch: string;
  /** SHA of HEAD at branch creation — useful for diff anchors. */
  startSha: string;
}

export interface CreateBranchErr {
  ok: false;
  /** Stable machine-readable error code so callers can branch on outcomes. */
  reason:
    | 'not-a-repo'
    | 'detached-head'
    | 'no-commits'
    | 'dirty-worktree'
    | 'branch-exists'
    | 'git-failed';
  /** Human-readable detail; safe to surface to the operator. */
  message: string;
}

/**
 * Create a fresh session branch from the current HEAD. Captures and
 * returns the original branch name so accept/discard can return there
 * without the caller having to remember.
 *
 * Refuses (returns `ok:false`) when:
 *   - workspace is not a git repo
 *   - HEAD is detached (no symbolic ref)
 *   - the repo has no commits yet (nothing to branch from)
 *   - the worktree is dirty (uncommitted changes)
 *   - a branch with `branch` name already exists
 */
export async function createSessionBranch(
  cwd: string,
  branch: string,
): Promise<CreateBranchOk | CreateBranchErr> {
  const state = await detectRepoState(cwd);
  if (!state.isRepo) {
    return { ok: false, reason: 'not-a-repo', message: 'workspace is not a git repository' };
  }
  if (!state.currentBranch) {
    return {
      ok: false,
      reason: 'detached-head',
      message: 'HEAD is detached; check out a branch before enabling isolation',
    };
  }
  if (!state.headSha) {
    return {
      ok: false,
      reason: 'no-commits',
      message: 'repository has no commits yet; make at least one commit before enabling isolation',
    };
  }
  if (state.dirty) {
    return {
      ok: false,
      reason: 'dirty-worktree',
      message:
        'worktree has uncommitted changes; commit or stash them first (auto-stashing is intentionally not supported)',
    };
  }
  if (await branchExists(cwd, branch)) {
    return {
      ok: false,
      reason: 'branch-exists',
      message: `branch "${branch}" already exists; refusing to overwrite`,
    };
  }
  const co = await runGit(cwd, ['checkout', '-b', branch]);
  if (co.code !== 0) {
    return {
      ok: false,
      reason: 'git-failed',
      message: `git checkout -b failed: ${co.stderr || co.stdout}`,
    };
  }
  return {
    ok: true,
    branch,
    originalBranch: state.currentBranch,
    startSha: state.headSha,
  };
}

/* ───── Per-turn commit ───── */

export interface CommitTurnResult {
  /** True when there were staged changes and a commit was created. */
  committed: boolean;
  /** New commit SHA (when committed). */
  sha: string | null;
  /** Number of files in this commit's diff (zero when not committed). */
  filesChanged: number;
}

/**
 * Stage everything in cwd, then commit *only if* there are staged
 * changes. No-op when nothing has changed since the last commit —
 * we never create empty commits, since empty commits during normal
 * operation would just clutter the granular log.
 *
 * Caller is responsible for checking that the session branch is the
 * current branch before calling. We don't auto-checkout — switching
 * branches during a session is a footgun.
 */
export async function commitTurn(
  cwd: string,
  message: string,
): Promise<CommitTurnResult> {
  const status = await runGit(cwd, ['status', '--porcelain']);
  if (status.code !== 0 || status.stdout.length === 0) {
    return { committed: false, sha: null, filesChanged: 0 };
  }
  const filesChanged = status.stdout.split('\n').filter((l) => l.trim().length > 0).length;
  const add = await runGit(cwd, ['add', '-A']);
  if (add.code !== 0) {
    throw new Error(`git add -A failed: ${add.stderr || add.stdout}`);
  }
  // `--allow-empty-message` defends against the edge where the caller
  // supplies an empty string by mistake; we still want a commit so the
  // turn is captured.
  const commit = await runGit(cwd, ['commit', '-m', message, '--allow-empty-message']);
  if (commit.code !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  const sha = await runGit(cwd, ['rev-parse', 'HEAD']);
  return {
    committed: true,
    sha: sha.code === 0 ? sha.stdout : null,
    filesChanged,
  };
}

/* ───── Branch status (for UI) ───── */

export interface BranchStatus {
  /** Number of commits on `branch` ahead of `originalBranch`. */
  commitCount: number;
  /** Files differing between `originalBranch` and `branch`. */
  filesChanged: number;
  /** True when worktree is dirty (uncommitted changes since last turn). */
  dirty: boolean;
}

export async function getBranchStatus(
  cwd: string,
  branch: string,
  originalBranch: string,
): Promise<BranchStatus> {
  const count = await runGit(cwd, ['rev-list', '--count', `${originalBranch}..${branch}`]);
  const commitCount =
    count.code === 0 ? Number.parseInt(count.stdout, 10) || 0 : 0;
  const diff = await runGit(cwd, [
    'diff',
    '--name-only',
    `${originalBranch}...${branch}`,
  ]);
  const filesChanged =
    diff.code === 0 && diff.stdout.length > 0
      ? diff.stdout.split('\n').filter((l) => l.length > 0).length
      : 0;
  const status = await runGit(cwd, ['status', '--porcelain']);
  const dirty = status.code === 0 && status.stdout.length > 0;
  return { commitCount, filesChanged, dirty };
}

/* ───── Accept (squash-merge into original) ───── */

export interface AcceptResult {
  ok: boolean;
  /** Stable error code on failure (only set when ok is false). */
  reason?: 'dirty-worktree' | 'checkout-failed' | 'merge-failed' | 'commit-failed' | 'cleanup-failed';
  message?: string;
  /** SHA of the squash commit on `originalBranch`, when ok. */
  mergeSha?: string;
}

/**
 * Squash-merge the session branch back into the original. The
 * resulting single commit on the original branch carries the supplied
 * `acceptMessage`. The session branch is then deleted.
 *
 * Refuses on a dirty worktree — accept is final and shouldn't race
 * with hand-edits in progress.
 */
export async function acceptIntoOriginal(
  cwd: string,
  branch: string,
  originalBranch: string,
  acceptMessage: string,
): Promise<AcceptResult> {
  const st = await runGit(cwd, ['status', '--porcelain']);
  if (st.code !== 0) {
    return { ok: false, reason: 'checkout-failed', message: `git status failed: ${st.stderr}` };
  }
  if (st.stdout.length > 0) {
    return {
      ok: false,
      reason: 'dirty-worktree',
      message: 'commit or discard pending changes before accepting',
    };
  }
  const co = await runGit(cwd, ['checkout', originalBranch]);
  if (co.code !== 0) {
    return {
      ok: false,
      reason: 'checkout-failed',
      message: `git checkout ${originalBranch} failed: ${co.stderr || co.stdout}`,
    };
  }
  const merge = await runGit(cwd, ['merge', '--squash', branch]);
  if (merge.code !== 0) {
    // Squash failed — back to the session branch so the operator can fix.
    await runGit(cwd, ['checkout', branch]);
    return {
      ok: false,
      reason: 'merge-failed',
      message: `git merge --squash ${branch} failed: ${merge.stderr || merge.stdout}`,
    };
  }
  // After squash the changes are staged but uncommitted. Commit them
  // with the operator-supplied message.
  const commit = await runGit(cwd, ['commit', '-m', acceptMessage, '--allow-empty-message']);
  if (commit.code !== 0) {
    return {
      ok: false,
      reason: 'commit-failed',
      message: `git commit (squash result) failed: ${commit.stderr || commit.stdout}`,
    };
  }
  const sha = await runGit(cwd, ['rev-parse', 'HEAD']);
  // Clean up the session branch. Use -D (force) only because we
  // explicitly created and own it — squash-merge doesn't update -d's
  // upstream-merged check, so safe-delete would refuse.
  const del = await runGit(cwd, ['branch', '-D', branch]);
  if (del.code !== 0) {
    return {
      ok: false,
      reason: 'cleanup-failed',
      message: `merged successfully but failed to delete ${branch}: ${del.stderr || del.stdout}`,
    };
  }
  return {
    ok: true,
    mergeSha: sha.code === 0 ? sha.stdout : undefined,
  };
}

/* ───── Discard (restore original, drop branch) ───── */

export interface DiscardResult {
  ok: boolean;
  reason?: 'checkout-failed' | 'cleanup-failed';
  message?: string;
}

/**
 * Discard the session branch entirely. Worktree is reset to the
 * original branch's HEAD; the SC branch is deleted. This is the
 * "undo everything sup did" button.
 *
 * We use `git checkout -- .` + `git clean -fd` to wipe any
 * still-uncommitted changes on the SC branch before checking out the
 * original, because checkout would otherwise refuse on dirty tree.
 * The risk surface is small: only files that became *untracked* during
 * the session get cleaned. Files that existed on `originalBranch`
 * before the session are restored from the index, never deleted.
 */
export async function discardBranch(
  cwd: string,
  branch: string,
  originalBranch: string,
): Promise<DiscardResult> {
  // Wipe uncommitted changes ON THE SESSION BRANCH so checkout can proceed.
  // `reset --hard` resets tracked files; `clean -fd` removes untracked.
  // Combined, the worktree returns to the SC branch's HEAD with no debris.
  const reset = await runGit(cwd, ['reset', '--hard', 'HEAD']);
  if (reset.code !== 0) {
    return {
      ok: false,
      reason: 'checkout-failed',
      message: `git reset --hard failed: ${reset.stderr || reset.stdout}`,
    };
  }
  const clean = await runGit(cwd, ['clean', '-fd']);
  if (clean.code !== 0) {
    return {
      ok: false,
      reason: 'checkout-failed',
      message: `git clean -fd failed: ${clean.stderr || clean.stdout}`,
    };
  }
  const co = await runGit(cwd, ['checkout', originalBranch]);
  if (co.code !== 0) {
    return {
      ok: false,
      reason: 'checkout-failed',
      message: `git checkout ${originalBranch} failed: ${co.stderr || co.stdout}`,
    };
  }
  const del = await runGit(cwd, ['branch', '-D', branch]);
  if (del.code !== 0) {
    return {
      ok: false,
      reason: 'cleanup-failed',
      message: `failed to delete branch ${branch}: ${del.stderr || del.stdout}`,
    };
  }
  return { ok: true };
}
