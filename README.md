# SelfClaude

A multi-agent layer for [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart). When a single CC session has to juggle frontend + backend + tests + security in one conversation, context drifts and the work gets sloppy. SelfClaude delegates each concern to its own specialist (separate subprocess, separate context window); a supervisor coordinates and reports back to you.

Install Claude Code first if you don't already use it — this is a layer, not a replacement.

---

## What a session looks like

You open a folder, type into the chat box:

> Refactor `src/server.ts` to split the route registration into its own file. Then make sure tests still pass.

What sup actually does (rendered from `chat-log.jsonl` for readability — real sessions are noisier):

```
sup              Plan: refactorer splits, then tester verifies.
sup → refactorer Split route registration from src/server.ts into src/routes.ts.
refactorer       Refused: "typecheck on the baseline already has 3 errors in
                 src/server.ts. Refactoring on a red tree is unsafe — please
                 re-route to developer to fix those first."
sup              Fair. Re-routing.
sup → developer  Fix the 3 typecheck errors in src/server.ts.
developer        Edit src/server.ts (+9, -7). typecheck green.
sup → refactorer Now split route registration as planned.
refactorer       Edit src/server.ts (-15), Edit src/routes.ts (+18).
                 typecheck green, tests pass (12/12).
sup → tester     Re-run the smoke suite to be sure.
tester           Ran `pnpm test` → 12 passed in 1.4s.
sup              Phase complete.
```

Three things to notice:
1. **Refactorer refused.** Its contract says "no rework on a red baseline." Sup adapted instead of forcing.
2. **Sup re-routed.** Failed delegation isn't a failure — it's the contract working.
3. **Two commits land** on a session-scoped git branch (if isolation is enabled — one-click toggle in the status bar). Click **Accept** to squash-merge into your branch, **Discard** to wipe the branch and restore the worktree.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/badursun/SelfClaude/main/install.sh | bash
```

**What this script does NOT do** (verifiable by reading the 175-line bash):
- No `sudo`, no root prompts.
- Does not touch `/etc`, `/usr`, `~/.bashrc`, or any system config.
- Does not modify your global `~/.claude/settings.json` — your existing Claude Code setup is left exactly where it is.
- Does not write anywhere outside `~/.selfclaude/` and a single symlink target.

What it does:
1. **Pre-flights** Node ≥20, pnpm (auto-installs via corepack if missing), and `claude` CLI signed in. Aborts with a fix-it message if any are missing.
2. **Clones** into `~/.selfclaude/app/`.
3. **Installs** dependencies via `pnpm install --frozen-lockfile`. No global npm installs.
4. **Symlinks** a `selfclaude` command into `/usr/local/bin` (or `~/.local/bin` if you don't have write access).

Removes cleanly: `rm -rf ~/.selfclaude/` plus deleting the symlink. Re-running the install command updates by `git pull` — idempotent.

macOS + Linux only; Windows is untested.

## Quickstart

```bash
selfclaude start
```

Opens http://127.0.0.1:3000/ in your browser. Open a folder, fill the wizard (or "Discover existing" for an already-built repo), type a request to sup.

The empty home page also has a **5-minute demo** button — it scaffolds a single-file portfolio HTML and opens it in your browser. Useful for seeing the shape of the orchestration before pointing it at real code.

---

## What can break

Real things, observed during development. Each item has a one-line user impact.

- **Long sessions get expensive fast.** A 1-hour session can burn through more API credit than the same work split into 4 fresh sessions, because token cost grows with conversation length and there's no auto-checkpoint yet. Watch the cost badge in the bottom toolbar; restart when it's growing faster than the work is.

- **Sup picks the wrong agent ~5–10% of the time.** Phase 8's decision rubric reduces this but doesn't eliminate it. If you see a feature task land on `tester` or a refactor land on `developer`, intervene with a clarifying message — sup will re-route.

- **Plan-mode `ExitPlanMode` calls freeze the turn.** No UI affordance to approve them yet. The `security` agent has been explicitly prompted not to call `ExitPlanMode` (returns findings as text; sup writes the report file as proxy). If you write a custom prompt for an agent in plan mode, instruct it the same way or your turn will hang on `Exit plan mode?`.

- **Parallel agents share one git branch.** Phase 5 isolates the *session*, not individual agents. Two parallel agents writing to the same file fall back to the in-memory file-lock manager, which prevents the in-flight Edit collision but doesn't help if both happened to commit on the same line. Per-agent worktree (Phase 5b) is on the roadmap; for now, prefer serial dispatch when two agents touch the same file.

- **Stuck detector misfires during long discovery.** Default threshold is 5 minutes without a file change or phase decision. If sup is genuinely thinking through an ambiguous spec with you, the amber banner will pop. Ignore it; or edit the threshold in `~/.selfclaude/settings.json` (eventually — currently hardcoded).

- **Linux works but is less tested than macOS.** Hook scripts assume `bash 4+`, `lsof`, `ps`. On Alpine + busybox you'll hit issues. Windows is entirely untested.

- **It's v0.x.** Breaking changes between minor versions are possible until 1.0.

If any of these are dealbreakers — wait a release cycle, or open an issue describing your specific failure mode.

---

## How it works

Three-step loop:

1. **You write** a request to sup in the chat box.
2. **Sup reads** the request, your `CLAUDE.md`, and any prior session state. It decides: ask a clarifying question, write a phase doc + delegate, or finish.
3. **Specialists execute** in their own Claude Code subprocesses. They report back to sup; sup verifies (reads files, runs tests, screenshots via Chrome when needed) and either marks the work done or sends it back.

**How sup decides who gets what.** Prompt-based, not deterministic — the decision rubric lives in `supervisor.md`. A simplified decision tree:

```
task starts with "add a test" / "verify" / "regression"  → tester
task starts with "rename" / "split" / "dedupe" / "tighten types" → refactorer
                                                                    (refuses if it touches behaviour)
task is read-only audit (secrets, injection, auth, deps)  → security
                                                            (returns findings as text; sup writes the report)
task is frontend (.tsx, components, layouts, forms)  → ui-dev
otherwise (backend, scripts, configs, general)  → developer
```

Sup mostly follows this. When it doesn't, it explains its reasoning in the chat — you can intervene.

The roster:

| Role | What it does |
|---|---|
| `supervisor` | Always-on. Plans, delegates, gates phases. |
| `developer` | Backend / general-purpose default. |
| `ui-dev` | Frontend specialist (shadcn / Tailwind / admin panel). |
| `security` | Read-only auditor. Returns findings as text; never edits. |
| `tester` | Verification-only. Writes + runs tests; refuses to edit product code. |
| `refactorer` | Bounded rework. Refuses features, new deps, behaviour changes. |

Hard-capped at 6 for v1.0. Custom roles will eventually drop in via `~/.selfclaude/agents.json` (plugin system pending).

Everything hangs off the chat-log on disk at `<your-project>/.selfclaude/chat-log.jsonl` — append-only, replayable. Two files in `.selfclaude/` you'll actually look at:

- `chat-log.jsonl` — every event (turns, tool calls, decisions, file changes).
- `phases.json` — structured phase tracker (Definition-of-Done items + status).

The rest is machine-managed (settings, hooks, scripts, telemetry). Your global `~/.claude/settings.json` is **not** touched.

---

## CLI

| Command | Purpose |
|---|---|
| `selfclaude start` | Start the daemon (web UI auto-opens) |
| `selfclaude stop` | Graceful shutdown |
| `selfclaude restart` | Reload after pulling new code |
| `selfclaude status` | Daemon up? PID, web URL |
| `selfclaude logs` / `logs -f` | Tail run log |
| `selfclaude link-telegram` | Pair a Telegram chat for off-screen prompts |
| `selfclaude doctor` | Sanity-check env + Telegram |

## Config

Optional `.env` — only for Telegram:

```ini
TELEGRAM_BOT_TOKEN=          # @BotFather
TELEGRAM_CHAT_ID=            # auto-filled by `selfclaude link-telegram`
```

`ANTHROPIC_API_KEY` is **not** read here — the `claude` CLI handles auth.

## Optional: Claude in Chrome

Sup has the `--chrome` flag enabled. If you've installed [Claude in Chrome](https://claude.ai/chrome), sup can browse + inspect pages as part of verification (open a deploy, check a route renders). Specialists don't have Chrome on purpose. If the extension isn't installed, sup just notes Chrome tools aren't available; nothing breaks.

---

## Architecture

**Where the decisions happen** (the runtime loop — read these if you want to understand the system):

- `packages/core/src/orchestrator/` — FSM, message bus, agent dispatch, phase contracts, stuck detector, failure-mode catalog.
- `packages/core/src/hooks/` — bash hook scripts post into a random-port HTTP bridge; this intercepts every tool call.
- `packages/core/src/mcp/` — stdio MCP server CC subprocesses spawn against; bridges `ask_user`, `request_user_approval`, phase tracker, etc.

**Surface** (UI + CLI + state — the parts you can swap):

- `packages/web/` — Next.js UI. This is the surface, not where the decisions happen.
- `packages/cli/` — daemon control.
- `packages/core/src/server/` — Fastify + SSE.
- `packages/core/src/agents/` — registry + DNA loader.
- `packages/core/src/project/` — `.selfclaude/*` round-trippers.

## Tests

```bash
pnpm test              # unit (300+) — about 6s
pnpm test:integration  # live `claude` subprocess tests — costs API credits
pnpm typecheck         # all packages
```

## Troubleshooting

- **`claude: command not found`** — install Claude Code: <https://docs.claude.com/en/docs/claude-code/quickstart>
- **Stale daemon after a crash** — `selfclaude stop` (handles stale PID files). Last resort: `rm ~/.selfclaude/run.pid && selfclaude start`.
- **Telegram not working** — `selfclaude doctor` checks bot reachability + chat pairing.
- **"Lost connection" toast** — fixed in current main; if you see it, share `selfclaude logs --orchestrator | tail -30` in an issue.
- **Session looks stuck (amber banner)** — stuck detector fired. Send a follow-up prompt, click Stop on the active turn, or wait if you know it's working in the background.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version: terse code, tests required, scoped diffs, no new built-in agents (cap is 6).

## License

MIT — see [LICENSE](./LICENSE).
