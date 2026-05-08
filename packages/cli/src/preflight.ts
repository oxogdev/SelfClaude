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
  ensureStreamJsonInputSupported();
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

/**
 * Verify the installed `claude` binary supports `--input-format stream-json`,
 * the IPC SelfClaude uses to feed prompts into a CC subprocess. Older CC
 * releases shipped with stream-json *output* but not *input*; the
 * orchestrator would otherwise fail at first turn with a confusing CC
 * error.
 *
 * We invoke `claude -p --input-format stream-json --output-format stream-json`
 * with no payload and a tight 5s timeout; CC exits quickly when its argv
 * parsing succeeds. If the `--input-format` flag is unknown, CC emits a
 * usage error containing the flag name on stderr — that's the marker we
 * match. Any other failure is treated as a runtime concern (auth, network)
 * and left for the orchestrator to surface at first turn.
 *
 * Adopted from PR #1 (Ersin KOÇ) — caught a real footgun for users still
 * on a months-old `claude` binary.
 */
function ensureStreamJsonInputSupported(): void {
  try {
    execFileSync(
      'claude',
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 },
    );
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    const stderr =
      typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr instanceof Buffer
          ? err.stderr.toString('utf8')
          : '';
    if (stderr.includes('--input-format')) {
      process.stderr.write(
        [
          '',
          '✗ The installed `claude` CLI is too old for SelfClaude.',
          '',
          'SelfClaude requires `--input-format stream-json` support, which landed',
          'in a recent Claude Code release. Update with:',
          '',
          '  npm update -g @anthropic-ai/claude-code',
          '  # or follow https://docs.claude.com/en/docs/claude-code/quickstart',
          '',
          'After updating, run `claude` once to confirm sign-in, then re-run',
          '`selfclaude start`.',
          '',
        ].join('\n'),
      );
      process.exit(1);
    }
    // Any other error class (timeout, auth, network) is not a version
    // problem — let the orchestrator surface the real issue when it
    // tries its first turn. Preflight is best-effort, not a gate.
  }
}
