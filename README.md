# SelfClaude

> Multi-agent orchestration for Claude Code. A **supervisor** agent plans + delegates, **specialist** agents (developer, ui-dev, security) execute in parallel, and **you** stay in the loop — gating phases, approving destructive work, and verifying results in a browser-based IDE.

SelfClaude is the layer above [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart). It spawns CC subprocesses for each agent role, coordinates them via tag-based delegation (`<TASK_FOR_DEVELOPER agent="ui-dev">…</TASK_FOR_DEVELOPER>`), arbitrates file locks during parallel work, persists chat history + project state, and surfaces everything in a Next.js web UI you drive from the browser.

## Install

One line on macOS / Linux. Requires Node 20+, git, and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/quickstart) installed + signed in:

```bash
curl -fsSL https://raw.githubusercontent.com/badursun/SelfClaude/main/install.sh | bash
```

The installer:
1. Pre-flights Node, pnpm (auto-bootstrapped via corepack), and `claude`.
2. Clones SelfClaude into `~/.selfclaude/app`.
3. Installs dependencies (`pnpm install --frozen-lockfile`).
4. Symlinks a global `selfclaude` command into `/usr/local/bin` or `~/.local/bin`.

Re-run the same command to update — it's idempotent.

## Quickstart

```bash
selfclaude start             # daemon mode; opens http://127.0.0.1:3000/ in your browser
```

The landing page lets you:
- **Open Project** → folder picker → wizard for new projects, or "Discover existing" for already-built repos
- **Pin** projects you return to often
- See **Active sessions** (live), **Pinned**, and **Recent** at a glance

For each session you get an IDE-style layout: supervisor chat on the left, specialist timeline in the middle, right-rail panels for tool detail / phases / audit / scripts / memory / decisions, and a left-rail file tree.

## CLI

Once installed, every command is global:

| Command | Purpose |
|---|---|
| `selfclaude start` | Start the daemon (web UI auto-opens in browser) |
| `selfclaude start --foreground` | Inline mode for debugging (Ctrl+C exits) |
| `selfclaude stop` | Graceful shutdown (SIGTERM → 5s grace → SIGKILL) |
| `selfclaude restart` | `stop` + `start` — reload after pulling new code |
| `selfclaude status` | Daemon up? PID, web URL |
| `selfclaude logs` | Last 100 lines of `~/.selfclaude/run.log` |
| `selfclaude logs -f` | Tail live |
| `selfclaude logs --orchestrator` | Structured event log (turn starts, FSM transitions) |
| `selfclaude link-telegram` | Pair a Telegram chat for off-screen prompts |
| `selfclaude doctor` | Sanity-check env + Telegram |

Daemon state lives in `~/.selfclaude/`:
- `run.pid`, `run.log` — process tracking
- `orchestrator.log` — structured events (JSONL)
- `favorites.json`, `recents.json` — landing-page lists

## How it works

```
                          ┌──────────┐
                          │  you     │
                          └────┬─────┘
                               │
              ┌────────────────▼──────────────────┐
              │  supervisor (PM, conversational)  │
              │  • discovery + planning           │
              │  • writes phase docs              │
              │  • verifies via Chrome / Bash     │
              └──┬──────────┬──────────┬──────────┘
                 │          │          │
              <TASK_FOR_DEVELOPER agent="…">  (parallel | serial)
                 │          │          │
        ┌────────▼┐  ┌──────▼──┐  ┌────▼─────┐
        │developer│  │ ui-dev  │  │ security │
        │(impl)   │  │(frontend│  │(read-only│
        │         │  │ specialist)│ auditor)│
        └────┬────┘  └────┬────┘  └────┬─────┘
             │            │            │
             └────────────┴────────────┘
                          │
                  reports → sup → you
```

**Orchestration loop.** Sup plans with you, writes phase docs to `<cwd>/docs/phases/*.md`, registers tracker items into `.selfclaude/phases.json`, then delegates to specialists with structured tag blocks. Specialists execute with the project files, propose items as done, sup confirms after spot-checking (Bash for read-only checks, Chrome for visible UI). Phase complete → next phase.

**Safety.** Hooks intercept every tool call (`PreToolUse`): destructive shell (`rm -rf`, `git push --force`, …) escalates to an in-UI approval modal; sensitive file writes likewise. File locks prevent two parallel agents from clobbering the same file. Bash policy bans long-lived foreground processes that would hang the turn.

**Continuity.** Session ids + chat-log persist to `<cwd>/.selfclaude/`. Closing your browser doesn't kill anything; re-opening picks up live. Daemon restart with `selfclaude restart` resumes from disk.

**Off-screen escalation.** A Telegram bot (optional, paired via `selfclaude link-telegram`) forwards questions / approvals you don't answer in 15 seconds, with replies routed back into the orchestrator.

## What lands in your project

After the first session, the working directory gets a `.selfclaude/` directory with everything SelfClaude needs to resume + everything the operator can inspect:

```
my-app/
├── .selfclaude/
│   ├── state.json           ← phase + session ids (resume target)
│   ├── chat-log.jsonl       ← append-only event log
│   ├── phases.json          ← structured phase tracker
│   ├── stack.json           ← normalized tech stack manifest
│   ├── settings.json        ← Claude Code hook config (--settings)
│   ├── mcp-config.json      ← Claude Code MCP config (--mcp-config)
│   ├── memory/              ← shared memory files (sup writes, agents read)
│   ├── scripts/             ← approved bash macros (chmod 755)
│   └── hooks/               ← pretool / stop / prompt-inject scripts
├── docs/
│   └── phases/
│       ├── 00-overview.md
│       └── 01-foundation.md
├── CLAUDE.md                ← project rules (sup writes during bootstrap)
└── …your code…
```

Your global `~/.claude/settings.json` is **untouched** — hook + MCP config are scoped via `--settings` / `--mcp-config` flags so they don't leak.

## Configuration (`.env`)

Copy `.env.example` → `.env` if you want Telegram. Otherwise, no setup required.

```ini
TELEGRAM_BOT_TOKEN=          # optional; @BotFather
TELEGRAM_CHAT_ID=            # auto-filled by `selfclaude link-telegram`
```

`ANTHROPIC_API_KEY` is **not** read here — the `claude` CLI handles auth itself.

## Optional: Claude in Chrome

The supervisor has the `--chrome` flag enabled, meaning if you've installed [Claude in Chrome](https://claude.ai/chrome) and granted permissions, sup can browse + inspect pages as part of its verification flow (open a deploy, check a route renders, fetch up-to-date docs). Specialists don't have Chrome on purpose — only sup, so the operator-facing verifier holds a tool the executing agents lack.

If the extension isn't installed, sup will simply note Chrome tools aren't available; nothing breaks.

## Architecture

| Module | Lives in | What it does |
|---|---|---|
| **Orchestrator** | `packages/core/src/orchestrator/` | FSM, message bus, agent dispatch, tag parser, file locks, bash safety, phase tracker. |
| **Web API** | `packages/core/src/server/` | Fastify on :7423. REST + SSE per session. SessionManager handles create / destroy / event broadcast. |
| **Hooks** | `packages/core/src/hooks/` | Random-port HTTP bridge that bash hook scripts post into; PreToolUse decisions, file-lock queries, agent identity. |
| **MCP** | `packages/core/src/mcp/` | stdio MCP server CC spawns; bridges `ask_user`, `request_user_approval`, `write_phase_doc`, `propose_item_done`, `propose_script`, `apply_agent_dna`, etc. |
| **Agents** | `packages/core/src/agents/` | Registry + DNA template loader. Bundled prompts for supervisor / developer / ui-dev / security; project-level DNA addenda. |
| **Project state** | `packages/core/src/project/` | `.selfclaude/*.json` round-trippers — chat-log, phase tracker, scripts, memory overview, telemetry. |
| **CLI** | `packages/cli/src/` | `selfclaude` binary + daemon control (start/stop/restart/logs/status). |
| **Web UI** | `packages/web/` | Next.js 14 app router + react-resizable-panels + zustand + SSE client. |
| **TUI (legacy)** | `packages/tui/` | Original Ink TUI — still works via `selfclaude start --tui`, deprecated. |

## Tests

```bash
pnpm test              # unit tests (parser, policy, FSM, stores, …) — ≈ 1s
pnpm test:integration  # live `claude` subprocess tests — ≈ 30s, costs API credits
pnpm typecheck         # all packages
```

## Troubleshooting

- **`claude: command not found`** — install Claude Code: <https://docs.claude.com/en/docs/claude-code/quickstart>
- **"Tab reappears after close"** — should be fixed in current main; if you see it, share `selfclaude logs --orchestrator | tail -30` in an issue.
- **Stale daemon after a crash** — `selfclaude stop` (handles stale PID files). If unrecoverable: `rm ~/.selfclaude/run.pid && selfclaude start`.
- **Telegram not working** — `selfclaude doctor` checks bot reachability + chat pairing.
- **Web UI shows "Lost connection"** — backend likely crashed; check `selfclaude logs | tail -50` for stack traces.

## Status

v0.0.1 — first public release. Core orchestration, web UI, multi-agent dispatch, phase tracker, scripts, MCP telemetry, DNA templates all working. Things expected to evolve:

- Custom DNA template UI (currently bundled-only)
- Linux / Windows compatibility beyond minimum (bash hook scripts assume bash 4+, lsof, ps)
- Per-agent metrics breakdown
- Daemon mode auto-start (launchd / systemd plist generators)

## Contributing

Issues + PRs welcome. The repo is a pnpm workspace; `pnpm install` from root, then work in any of the four packages. Most flows have integration tests that exercise live `claude` subprocesses — running them costs API credits but is the only way to catch real protocol drift.

## License

MIT — see [LICENSE](./LICENSE).
