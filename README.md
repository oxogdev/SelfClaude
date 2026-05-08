# SelfClaude

**Multi-agent orchestration on top of Claude Code.** A supervisor delegates, specialists (developer · ui-dev · security · tester · refactorer) execute, you gate. Browser-based IDE; local-first.

**Install if you** already use Claude Code daily, want it to coordinate itself across multiple sub-agents instead of you doing the routing, value an audit trail + per-session git-branch isolation + one-click session rollback, and can live with a v0.x cadence (works, rough edges remain).

**Skip if you** haven't tried Claude Code itself yet (start there), need a hosted product, want a chat-only single-agent loop (CC alone is simpler), or need a production-stable tool today.

---

## Is this for me? (3 questions)

1. **Do you regularly find yourself running two Claude windows side-by-side and copy-pasting between them?** If yes, this is the layer that automates that. If no, you probably don't need it.
2. **Do you want a paper trail — phase docs, decision log, git branch per session, exportable markdown report — or are short ad-hoc chats enough?** SelfClaude is paper-trail-heavy. If the audit story doesn't matter to you, the overhead won't pay off.
3. **Are you comfortable running a local daemon + browser UI on your own machine?** No cloud, no hosting. If you wanted hosted, this isn't it.

If 2 of 3 are "yes" → install. Otherwise → save the disk space.

## Install

One line on macOS / Linux. Requires Node 20+, git, and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/quickstart) installed + signed in:

```bash
curl -fsSL https://raw.githubusercontent.com/badursun/SelfClaude/main/install.sh | bash
```

The installer pre-flights `node` / `pnpm` / `claude`, clones into `~/.selfclaude/app`, installs deps, and symlinks a global `selfclaude` command. Re-run to update — idempotent.

## Quickstart

```bash
selfclaude start             # daemon mode; opens http://127.0.0.1:3000/ in your browser
```

The landing page lets you open a project (folder picker → wizard, or "Discover existing" for already-built repos), pin frequently-used projects, and see active / pinned / recent at a glance. Each session opens an IDE-style layout: supervisor chat (left), specialist timeline (middle), right-rail panels for tool detail / phases / audit / scripts / memory / decisions, and a left-rail file tree.

## Why not just Claude Code?

Honest comparison — Claude Code is excellent and SelfClaude is built on top of it, not against it.

| You're doing… | Use Claude Code | Use SelfClaude |
|---|:---:|:---:|
| Quick one-off chats, single agent, single file | ✓ | overkill |
| "Implement feature X" — a single pair-programming flow | ✓ | overkill |
| Building or refactoring a real project across many turns | also fine | ← right tool |
| Want frontend + backend + security review in one session, in parallel | hand-route yourself | ← that's the point |
| Want to start a session, walk away, come back to a checkable audit trail | ✓ ish | ← yes |
| Want git-branch isolation so a risky session is one-click revertible | manual | ← built in |
| Need browser-based UI with multiple project tabs | nope | ← built in |

If you're not already using Claude Code: install that first. SelfClaude is a layer; the layer is useless without the model under it.

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
              └──┬───────┬───────┬───────┬───────┬┘
                 │       │       │       │       │
         <TASK_FOR_DEVELOPER agent="…">  (parallel | serial)
                 │       │       │       │       │
        ┌────────▼┐ ┌────▼───┐ ┌─▼──────┐ ┌──▼───┐ ┌─▼─────────┐
        │developer│ │ ui-dev │ │security│ │tester│ │refactorer │
        └────┬────┘ └───┬────┘ └───┬────┘ └──┬───┘ └──┬────────┘
             │          │          │         │         │
             └──────────┴──────────┴─────────┴─────────┘
                          │
                  reports → sup → you
```

**Orchestration loop.** Sup plans with you, writes phase docs, registers tracker items, then delegates to specialists with structured tag blocks. Specialists execute, propose items as done, sup confirms after spot-checking. Phase complete → next phase.

**Safety.** Hooks intercept every tool call; destructive shell + sensitive writes escalate to in-UI approval. File locks prevent two parallel agents from clobbering the same file. Each session optionally runs on its own git branch — accept squash-merges into your branch, discard wipes the whole branch.

**Continuity.** Session state persists to `<cwd>/.selfclaude/`. Closing the browser doesn't kill anything; daemon restart resumes from disk.

**Off-screen escalation.** Optional Telegram bot forwards questions / approvals you don't answer in 15 seconds; replies route back into the orchestrator.

## CLI

| Command | Purpose |
|---|---|
| `selfclaude start` | Start the daemon (web UI auto-opens) |
| `selfclaude start --foreground` | Inline mode for debugging |
| `selfclaude stop` | Graceful shutdown |
| `selfclaude restart` | Reload after pulling new code |
| `selfclaude status` | Daemon up? PID, web URL |
| `selfclaude logs` / `logs -f` | Tail run log |
| `selfclaude logs --orchestrator` | Structured event log |
| `selfclaude link-telegram` | Pair a Telegram chat for off-screen prompts |
| `selfclaude doctor` | Sanity-check env + Telegram |

Daemon state lives in `~/.selfclaude/` (`run.pid`, `run.log`, `orchestrator.log`, `favorites.json`, `recents.json`).

## What lands in your project

After the first session, the working directory gets a `.selfclaude/` directory with everything SelfClaude needs to resume + everything the operator can inspect:

```
my-app/
├── .selfclaude/
│   ├── state.json           ← phase + session ids (resume target)
│   ├── chat-log.jsonl       ← append-only event log
│   ├── session-metrics.jsonl ← Phase 2 telemetry events
│   ├── phases.json          ← structured phase tracker
│   ├── stack.json           ← normalized tech stack manifest
│   ├── git-isolation.json   ← branch isolation state (if enabled)
│   ├── settings.json        ← Claude Code hook config
│   ├── mcp-config.json      ← Claude Code MCP config
│   ├── memory/              ← shared memory files
│   ├── scripts/             ← approved bash macros
│   └── hooks/               ← pretool / stop / prompt-inject scripts
├── docs/phases/             ← phase briefs (sup writes via contract)
├── reports/security/        ← security audit reports (sup writes as proxy)
├── CLAUDE.md                ← project rules (sup writes during bootstrap)
└── …your code…
```

Your global `~/.claude/settings.json` is **untouched** — hook + MCP config are scoped via `--settings` / `--mcp-config` flags so they don't leak.

## Configuration

Optional `.env` for Telegram only:

```ini
TELEGRAM_BOT_TOKEN=          # optional; @BotFather
TELEGRAM_CHAT_ID=            # auto-filled by `selfclaude link-telegram`
```

`ANTHROPIC_API_KEY` is **not** read here — the `claude` CLI handles auth itself.

## Optional: Claude in Chrome

Sup has the `--chrome` flag enabled. If you've installed [Claude in Chrome](https://claude.ai/chrome) and granted permissions, sup can browse + inspect pages as part of its verification flow (open a deploy, check a route renders, fetch up-to-date docs). Specialists don't have Chrome on purpose — only sup, so the operator-facing verifier holds a tool the executing agents lack.

If the extension isn't installed, sup just notes Chrome tools aren't available; nothing breaks.

## Architecture

| Module | Lives in | What it does |
|---|---|---|
| **Orchestrator** | `packages/core/src/orchestrator/` | FSM, message bus, agent dispatch, tag parser, file locks, bash safety, phase tracker, phase contracts, inbox compressor, stuck detector, failure-mode catalog. |
| **Web API** | `packages/core/src/server/` | Fastify on :7423. REST + SSE per session. SessionManager handles create / destroy / event broadcast. |
| **Hooks** | `packages/core/src/hooks/` | Random-port HTTP bridge that bash hook scripts post into. |
| **MCP** | `packages/core/src/mcp/` | stdio MCP server CC spawns; bridges `ask_user`, `request_user_approval`, `write_phase_doc`, `propose_item_done`, `propose_script`, `apply_agent_dna`, etc. |
| **Agents** | `packages/core/src/agents/` | Registry + DNA template loader. Bundled prompts for the 6 built-in roles; project-level DNA addenda; hard-cap policy on additions. |
| **Project state** | `packages/core/src/project/` | `.selfclaude/*` round-trippers — chat-log, phase tracker, scripts, memory overview, telemetry, git-isolation. |
| **CLI** | `packages/cli/src/` | `selfclaude` binary + daemon control. |
| **Web UI** | `packages/web/` | Next.js 14 app router + react-resizable-panels + zustand + SSE client. |

## Tests

```bash
pnpm test              # unit tests (300+) — about 6s
pnpm test:integration  # live `claude` subprocess tests — costs API credits
pnpm typecheck         # all packages
```

## Troubleshooting

- **`claude: command not found`** — install Claude Code: <https://docs.claude.com/en/docs/claude-code/quickstart>
- **Stale daemon after a crash** — `selfclaude stop` (handles stale PID files). If unrecoverable: `rm ~/.selfclaude/run.pid && selfclaude start`.
- **Telegram not working** — `selfclaude doctor` checks bot reachability + chat pairing.
- **"Lost connection" toast** — should be fixed in current main; if you see it, share `selfclaude logs --orchestrator | tail -30` in an issue.
- **Session looks stuck (amber banner)** — stuck detector fired. Send a follow-up prompt, click Stop on the active turn, or wait if you know it's working in the background.

## Status

v0.x — pre-1.0. Honest scorecard:

- ✅ Core orchestration, web UI, multi-agent dispatch (6 roles), phase tracker, scripts, MCP telemetry, DNA templates
- ✅ Phase contracts (sup phase docs validated against required-section schema)
- ✅ Per-session metrics + first-pass-rate badge
- ✅ Git branch isolation with auto-commit + accept/discard
- ✅ Decision trail + markdown report export
- ✅ Failure mode catalog + standardised error banner + stuck detection
- ⏸ Per-agent worktree (parallel agents currently share one branch)
- ⏸ Sup memory layer / smarter DEVELOPER_REPORT compression
- ⏸ Plugin system for custom built-in agents (current cap: 6)
- ⏸ Daemon auto-start (launchd / systemd plist generators)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version: terse code, tests required, scoped diffs, no new built-in agents (cap is 6 — plugin system pending).

## License

MIT — see [LICENSE](./LICENSE).
