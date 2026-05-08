# SelfClaude

A multi-agent layer for [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart). A supervisor delegates to specialists (developer, ui-dev, security, tester, refactorer) and reports back; you watch + gate decisions in a browser UI.

If Claude Code isn't already in your daily workflow, install that first — SelfClaude is a layer, and the layer needs the model under it.

---

## What a session looks like

You open a folder, type into the chat box:

> Add a `/health` endpoint to the Fastify server, then write a test for it.

Roughly what sup does (rendered from `chat-log.jsonl` for readability):

```
sup            Plan: developer adds the route, tester writes the smoke test.
sup → dev      Add GET /health to src/server/routes.ts. Return {status:'ok'}.
developer      Edit src/server/routes.ts (+7 lines)
developer      Done. Route registered, returns 200.
sup            Reading the file to confirm the contract...
sup            Confirmed. Delegating tester next.
sup → tester   Write a test for GET /health.
tester         Edit tests/health.test.ts (+11 lines)
tester         Ran the test runner — 1 passed in 280ms.
sup            Phase complete.
```

You see all of this live. Two commits land on a session-scoped git branch (if isolation is enabled — one-click toggle in the status bar). At the end you click **Accept** to squash-merge into your branch, or **Discard** to wipe the branch and restore the worktree.

That's the loop. The rest of this README is about install, what can break, and how it actually works.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/badursun/SelfClaude/main/install.sh | bash
```

What the script does (full breakdown — read it yourself if you want, it's 175 lines of bash):

1. **Pre-flights** Node ≥20, pnpm (auto-installs via corepack if missing), and `claude` CLI signed in. Aborts with a fix-it message if any are missing.
2. **Clones** into `~/.selfclaude/app/` — your home dir, not system-wide. Nothing writes outside `~/.selfclaude/` and the symlink target.
3. **Installs** dependencies via `pnpm install --frozen-lockfile`. No global npm installs.
4. **Symlinks** a `selfclaude` command into `/usr/local/bin` (or `~/.local/bin` if you don't have write access).

Re-running updates by `git pull` — idempotent. Removes cleanly: `rm -rf ~/.selfclaude/` + delete the symlink. macOS + Linux only; Windows is untested.

## Quickstart

```bash
selfclaude start
```

Opens http://127.0.0.1:3000/ in your browser. Open a folder, fill the wizard (or "Discover existing" for an already-built repo), type a request to sup.

The empty home page also has a **5-minute demo** button — it scaffolds a single-file portfolio HTML and opens it in your browser. Useful if you want to see the orchestration shape before pointing it at real code.

---

## What can break

Honest list — these are observed, not hypothetical.

- **Sup picks the wrong agent sometimes.** Phase 8 added an explicit decision rubric (tester for tests, refactorer for cleanup, security read-only, etc.) that reduces this, but heuristic delegation is heuristic. Watch the agent name in the chat-log; if a feature task lands on `tester`, intervene.
- **Token cost is uncapped.** Long sessions accumulate context. There's a per-session token estimator, but no automatic checkpoint-and-restart yet. For multi-hour work, prefer breaking into shorter sessions.
- **Plan-mode `ExitPlanMode` has no UI.** If an agent calls it, the turn waits for an operator response that can't arrive. The `security` agent has been explicitly prompted not to call it (returns findings as text; sup writes the report file as proxy). Other agents shouldn't hit this in normal use, but a custom prompt could.
- **Parallel agents share one git branch.** Phase 5 isolates the *session*, not individual agents. Two parallel agents writing to the same file fall back to the in-memory file-lock manager; on-disk collisions are theoretically possible.
- **Stuck detector is heuristic.** Default threshold is 5 minutes without a file change or phase decision. False positives during long discovery conversations happen.
- **Linux works but is less tested than macOS.** Hook scripts assume `bash 4+`, `lsof`, `ps`. Windows is untested.
- **It's v0.x.** Breaking changes between minor versions are possible until 1.0.

If any of these are dealbreakers — wait a release cycle, or open an issue describing your specific failure mode.

---

## How it works

Three-step loop:

1. **You write** a request to sup in the chat box.
2. **Sup reads** the request, your `CLAUDE.md`, and any prior session state. It decides: ask a clarifying question, write a phase doc + delegate to a specialist, or finish.
3. **Specialists execute** in their own Claude Code subprocesses. They report back, sup verifies (reads files, runs tests, screenshots via Chrome when needed), and either marks the work done or sends it back.

The roster is six built-in roles:

| Role | What it does |
|---|---|
| `supervisor` | Always-on. Plans, delegates, gates phases. |
| `developer` | Backend / general-purpose default. |
| `ui-dev` | Frontend specialist (shadcn / Tailwind / admin panel). |
| `security` | Read-only auditor. Returns findings as text; never edits. |
| `tester` | Verification-only. Writes + runs tests; never touches product code. |
| `refactorer` | Bounded rework. Renames / splits / dedupes; refuses features or new deps. |

The roster is **hard-capped at 6** for v1.0 — adding a 7th built-in is bounced. Custom roles will eventually drop in via `~/.selfclaude/agents.json` (plugin system pending).

Everything hangs off the chat-log on disk at `<your-project>/.selfclaude/chat-log.jsonl` — append-only, replayable. Two files in `.selfclaude/` you'll actually look at:

- `chat-log.jsonl` — every event (turns, tool calls, decisions, file changes).
- `phases.json` — structured phase tracker (Definition-of-Done items + status).

The rest is machine-managed (settings, hooks, scripts, telemetry). Your global `~/.claude/settings.json` is **not** touched — SelfClaude scopes config via `--settings` / `--mcp-config` flags so it never leaks into your other Claude Code usage.

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

Sup has the `--chrome` flag enabled. If you've installed [Claude in Chrome](https://claude.ai/chrome), sup can browse + inspect pages as part of verification (open a deploy, check a route renders, fetch up-to-date docs). Specialists don't have Chrome on purpose.

If the extension isn't installed, sup just notes Chrome tools aren't available; nothing breaks.

---

## Architecture (read the code)

The runtime loop:

- `packages/core/src/orchestrator/` — FSM, message bus, agent dispatch, phase contracts, stuck detector, failure-mode catalog.
- `packages/core/src/hooks/` — bash hook scripts post into a random-port HTTP bridge; this intercepts every tool call.
- `packages/core/src/mcp/` — stdio MCP server CC subprocesses spawn against; bridges `ask_user`, `request_user_approval`, phase tracker, etc.

Plumbing around it:

- `packages/core/src/server/` — Fastify + SSE.
- `packages/core/src/agents/` — registry + DNA loader.
- `packages/core/src/project/` — `.selfclaude/*` round-trippers.
- `packages/web/` — Next.js UI.
- `packages/cli/` — daemon control.

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
