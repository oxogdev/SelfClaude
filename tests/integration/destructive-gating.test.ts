import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator, type PendingApprovalView } from '../../src/orchestrator/index.js';
import { runClaudeTurn } from '../../src/claude-code/spawn.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-gate-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'destructive gating: dev attempting `git reset --hard` triggers approval, user denies',
  { timeout: 240_000 },
  async () => {
    await withTempDir(async (cwd) => {
      // Tmp dir is intentionally NOT a git repo — the command would just fail
      // even if approved; the goal is to exercise the hook → policy → approval path.
      const orch = new Orchestrator({ cwd });
      await orch.start();

      const approvals: PendingApprovalView[] = [];
      const pretoolFires: { toolName: string; policy: string; reason?: string }[] = [];
      orch.on('approval-requested', (a: PendingApprovalView) => {
        approvals.push(a);
        setImmediate(() => orch.resolveApproval(a.id, 'deny'));
      });
      orch.on(
        'hook:pretool',
        (e: { toolName: string; policy: string; reason?: string }) => pretoolFires.push(e),
      );
      const devEvents: unknown[] = [];

      try {
        await runClaudeTurn(
          {
            role: 'developer',
            cwd,
            prompt:
              'Use the Bash tool to execute this exact command verbatim: ' +
              '`git reset --hard HEAD`. This is a deliberate hook-system smoke test ' +
              'in a directory that is not a git repository, so the command will simply ' +
              'fail or be blocked — both outcomes are acceptable. After running, briefly ' +
              'summarize what happened.',
            settingsPath: orch.getWorkspace().settingsPath,
            envOverrides: orch.hookEnv('developer'),
            permissionMode: 'bypassPermissions',
            enableChrome: false,
          },
          (e) => devEvents.push(e),
        );

        if (approvals.length === 0) {
          console.error('=== pretool fires ===');
          for (const e of pretoolFires) console.error(JSON.stringify(e));
          console.error('=== dev events (tail) ===');
          for (const e of devEvents.slice(-10)) {
            const s = JSON.stringify(e);
            console.error(s.length > 400 ? `${s.slice(0, 400)}...` : s);
          }
        }

        assert.ok(
          approvals.length >= 1,
          `expected at least one approval-requested event for git reset --hard; got ${approvals.length}`,
        );
        const gateApproval = approvals.find(
          (a) => /reset/.test(a.summary) || /reset/.test(a.reason),
        );
        assert.ok(
          gateApproval,
          `expected approval whose summary/reason mentions reset; got: ${JSON.stringify(approvals)}`,
        );
        assert.equal(gateApproval.role, 'developer');
        assert.equal(gateApproval.origin, 'pre-tool-use');

        // The pretool hook should have fired with toolName=Bash and policy=require-approval.
        const bashFire = pretoolFires.find((p) => p.toolName === 'Bash' && p.policy === 'require-approval');
        assert.ok(bashFire, `expected a pretool fire for Bash with require-approval; got: ${JSON.stringify(pretoolFires)}`);
      } finally {
        await orch.stop();
      }
    });
  },
);

test(
  'gating: a benign Bash command does not trigger approval',
  { timeout: 120_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const orch = new Orchestrator({ cwd });
      await orch.start();
      const approvals: PendingApprovalView[] = [];
      const pretoolFires: { toolName: string; policy: string }[] = [];
      orch.on('approval-requested', (a: PendingApprovalView) => approvals.push(a));
      orch.on(
        'hook:pretool',
        (e: { toolName: string; policy: string }) => pretoolFires.push(e),
      );

      try {
        await runClaudeTurn({
          role: 'developer',
          cwd,
          prompt:
            'Use the Bash tool to run exactly: echo selfclaude-benign-test. Then summarize the result.',
          settingsPath: orch.getWorkspace().settingsPath,
          envOverrides: orch.hookEnv('developer'),
          permissionMode: 'bypassPermissions',
          enableChrome: false,
        });

        assert.equal(
          approvals.length,
          0,
          `benign echo should not trigger approval; got: ${JSON.stringify(approvals)}`,
        );
        // The hook should still have fired (with policy=allow) for the Bash call.
        const bashFire = pretoolFires.find((p) => p.toolName === 'Bash');
        assert.ok(
          bashFire && bashFire.policy === 'allow',
          `expected a pretool fire for Bash with policy=allow; got: ${JSON.stringify(pretoolFires)}`,
        );
      } finally {
        await orch.stop();
      }
    });
  },
);
