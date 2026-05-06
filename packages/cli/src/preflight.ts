import { execFileSync } from 'node:child_process';

/**
 * Lightweight environment sanity check run at the top of every
 * SelfClaude command path that boots an orchestrator. Surfaces a
 * clear, actionable error before the user lands in a confusing
 * runtime failure (claude subprocess not found, blank web UI, etc.).
 *
 * The single hard requirement is the `claude` CLI (Anthropic Claude
 * Code) — SelfClaude is a wrapper around it, not a replacement. If
 * that's missing, we exit early with an install link.
 *
 * This runs synchronously and exits the process on failure; that's
 * intentional — the CLI shouldn't try to recover from a missing
 * dependency, just tell the operator what to do and bail.
 */
export function ensurePreflight(): void {
  ensureClaudeCli();
}

function ensureClaudeCli(): void {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
  } catch {
    process.stderr.write(
      [
        '',
        '✗ The `claude` CLI is not installed (or not on PATH).',
        '',
        'SelfClaude orchestrates Claude Code subprocesses — it needs Anthropic\'s',
        'official CLI. Install it, then re-run:',
        '',
        '  https://docs.claude.com/en/docs/claude-code/quickstart',
        '',
        'After install, run `claude` once to sign in (it links to your Anthropic',
        'or Claude account). Then `selfclaude start` will pick it up automatically.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}
