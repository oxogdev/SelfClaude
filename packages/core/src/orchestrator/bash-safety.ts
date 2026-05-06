/**
 * Bash safety pre-check: detects shell commands that look like they will
 * never exit on their own (servers, watchers, dev daemons) and flag them
 * unless the model has wrapped them in a backgrounding / timeout pattern.
 *
 * The motivation is concrete: a supervisor turn once invoked `pnpm start`
 * directly via Bash. The dev server runs forever, so the Bash tool call
 * never returned, the supervisor's turn never closed, and the entire
 * orchestrator wedged for ~6 minutes until the operator killed the
 * orphan PID by hand. The system prompt now warns against this pattern,
 * but a layered defence — orchestrator-level rejection — keeps the
 * workflow honest even when the model forgets.
 *
 * Behaviour: when this returns an issue, the orchestrator's PreToolUse
 * hook responds with `decision: 'deny'`. The model receives the reason
 * and almost always retries with a corrected command (background +
 * sleep + verify + kill, or `timeout N`).
 *
 * False positives are preferable to false negatives here — a denied
 * sanity check can be re-issued in seconds; a hung server costs minutes
 * and operator attention.
 */

export interface BashSafetyIssue {
  /** Short human-readable explanation surfaced to the model. */
  reason: string;
  /** Concrete pattern the model should follow to satisfy the check. */
  hint: string;
}

/**
 * Patterns that match commands which typically run forever (dev servers,
 * file watchers, REPLs). Each is anchored on a word boundary so unrelated
 * uses of the same words (e.g. `npm start` inside a doc comment) don't
 * trip — we're matching the literal command, not arbitrary text.
 */
const LONG_RUNNING_PATTERNS: ReadonlyArray<RegExp> = [
  // pnpm / npm / yarn dev/start/serve/watch
  /\b(pnpm|npm|yarn)\s+(start|run\s+(dev|start|serve|watch|preview))\b/,
  /\b(pnpm|npm|yarn)\s+(dev|serve|watch|preview)\b/,
  // Next/Vite/etc. binaries directly
  /\b(next|vite|astro|nuxt|remix)\s+(dev|start|preview)\b/,
  // Plain `node <something>.js` — heuristic, but production servers all match
  /\bnode\s+\S+\.(c?js|mjs|ts)\b/,
  // Python's stdlib http.server, Flask/FastAPI dev runners
  /\bpython3?\s+-m\s+http\.server\b/,
  /\b(flask|uvicorn|gunicorn|hypercorn)\s+/,
  // Long-running shell utilities
  /\btail\s+-[^\s]*f/,
  /\bwatch\s+/,
  /\bnodemon\b/,
  /\btsx\s+watch\b/,
  // Docker compose attached
  /\bdocker(\s+compose)?\s+up\b(?!.*\s-d\b)/,
];

/**
 * Patterns whose presence in the same command string indicates the model
 * has wrapped the long-runner safely (backgrounded with cleanup, or hard
 * timeout). Any one of these is sufficient to clear the safety check.
 */
const SAFETY_PATTERNS: ReadonlyArray<RegExp> = [
  // POSIX background operator at end of a statement
  /&\s*(?:$|;|\|\||&&|\bsleep\b)/,
  // Explicit nohup
  /\bnohup\b/,
  // GNU/macOS coreutils `timeout N ...`
  /\btimeout\s+\d/,
  // Docker / kubectl detached flag
  /\b-d\b/,
  // disown / setsid
  /\b(disown|setsid)\b/,
];

/**
 * Inspect the raw `tool_input` of a Bash tool call. Returns null if the
 * command looks safe (or is irrelevant), or an issue object if it looks
 * like a hang risk.
 */
export function checkBashSafety(toolInput: unknown): BashSafetyIssue | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const cmd = (toolInput as { command?: unknown }).command;
  if (typeof cmd !== 'string' || cmd.trim().length === 0) return null;

  // If the model set a tight Bash-tool-level `timeout` (≤ 5 minutes), trust
  // it — CC will kill the call itself. Anything longer than 5 minutes is
  // suspicious enough to still demand structural safety.
  const explicitTimeout = (toolInput as { timeout?: unknown }).timeout;
  if (typeof explicitTimeout === 'number' && explicitTimeout > 0 && explicitTimeout <= 300_000) {
    return null;
  }

  for (const longRunner of LONG_RUNNING_PATTERNS) {
    if (!longRunner.test(cmd)) continue;
    const wrapped = SAFETY_PATTERNS.some((kw) => kw.test(cmd));
    if (wrapped) return null;
    return {
      reason:
        'Bash command appears to start a long-lived process without backgrounding it. ' +
        'The Bash tool call cannot complete until the command exits, so a foreground ' +
        'server/watcher will hang the agent\'s turn forever and freeze the workflow.',
      hint:
        'Either wrap the call as a one-shot — ' +
        '`nohup CMD > /tmp/x.log 2>&1 & PID=$!; sleep 2; <verify>; kill $PID 2>/dev/null` — ' +
        'or use `timeout N CMD` for a hard cap, or set the Bash tool\'s `timeout` ' +
        'parameter (≤ 300000 ms) so the orchestrator can let it through.',
    };
  }
  return null;
}
