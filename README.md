# SelfClaude

Two-Claude orchestration TUI: a **Supervisor** agent (PM) and a **Developer** agent (coder) running side by side as Claude Code subprocesses, coordinated by a thin Node/TypeScript orchestrator. Replaces the manual copy-paste between desktop Claude (planning) and terminal Claude Code (executing) with a single screen.

## How it works

```
       you
        │
        ▼
┌──────────────┐                ┌──────────────┐
│ Supervisor   │  ──tasks──>    │ Developer    │
│ (PM/discovery│                │ (writes code,│
│  /docs/orch.)│  <─reports──   │  uses tools) │
└──────┬───────┘                └──────┬───────┘
       │                               │
       └─── hooks (Stop, PreToolUse, ──┘
            UserPromptSubmit) +
            MCP (ask_user, request_user_approval, write_phase_doc)
                       │
                       ▼
            ┌────────────────────┐
            │  Orchestrator (TS) │
            │  + Ink TUI         │
            │  + Telegram bridge │
            └────────────────────┘
```

- **Discovery** — supervisor talks with you about goals, stack, scope, then writes `docs/phases/*.md`.
- **Execution** — supervisor delegates concrete work to the developer with `<TASK_FOR_DEVELOPER>...</TASK_FOR_DEVELOPER>` tags; developer reports back; supervisor escalates to you only when stuck (`ask_user`) or for risky actions (`request_user_approval`).
- **Safety** — destructive shell commands (`rm -rf`, `git push --force`, `docker volume prune`, etc.) trigger an approval modal that you must allow.
- **Continuity** — `.selfclaude/state.json` persists session ids and phase, so a `selfclaude start` later picks up where you left off.
- **Telegram fallback** — questions/approvals you don't answer on screen within 15 s are forwarded to your private Telegram chat.

## Requirements

- Node 20+
- `claude` CLI (Claude Code) installed and authenticated
- `pnpm` (or `npm` / `yarn`, but the scripts use `pnpm`)
- Optional: a Telegram bot token (from `@BotFather`)

## Install

```bash
git clone <this-repo>
cd SelfClaude
pnpm install
```

Verify the toolchain:

```bash
pnpm typecheck
pnpm test
```

## Configure Telegram (optional but recommended)

1. Create a bot with `@BotFather`, copy the token.
2. Put the token in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123:ABC…
   ```
   (or in `.env.example` — `.env` wins, `.env.example` is read as a fallback.)
3. Pair your chat (interactive auto-discovery):
   ```bash
   pnpm dev link-telegram
   ```
   The CLI prints a 6-digit code; open the bot in Telegram, send the code; the CLI saves `TELEGRAM_CHAT_ID=…` to `.env`.
4. Verify:
   ```bash
   pnpm dev doctor
   # Telegram bot: reachable (@your_bot)
   ```

## Run

In the project you want to drive (e.g. a fresh empty directory):

```bash
cd ~/Developer/projects/MyApp
pnpm --dir ~/Developer/projects/SelfClaude dev start
```

Or, with the directory passed explicitly:

```bash
cd ~/Developer/projects/SelfClaude
pnpm dev start --cwd ~/Developer/projects/MyApp
```

What you see:

- Top: status bar — current phase, who's running, Telegram connection.
- Left pane: supervisor chat (your messages and supervisor replies).
- Right pane: developer activity (tool calls, file edits, output).
- Bottom: input bar — type to message the supervisor; when a question or approval modal is up, type your reply / `y`/`n`.
- Ctrl+C: graceful exit. Session ids are persisted; next start resumes.

## Demo (no real Claude calls)

```bash
pnpm dev start --demo
```

Synthetic events drive the panes for ~7 s, ending in a sample question modal. Useful for verifying TUI rendering on a new machine.

## Layout in the target project

After `selfclaude start`, the working directory gets:

```
my-app/
├── .selfclaude/
│   ├── state.json          ← phase + session ids (persistent)
│   ├── settings.json       ← Claude Code hook config (used via --settings)
│   ├── mcp-config.json     ← Claude Code MCP config (used via --mcp-config)
│   └── hooks/
│       ├── stop.sh
│       ├── pretool.sh
│       └── prompt-inject.sh
└── docs/
    └── phases/
        ├── 00-overview.md   ← supervisor writes during documentation
        ├── 01-foundation.md
        └── …
```

The orchestrator never touches the user's `~/.claude/settings.json`. Hooks and MCP servers are isolated to `--settings`/`--mcp-config` flags so they don't leak into other Claude Code usage.

## Architecture

- **Orchestrator** (`src/orchestrator/`) — long-lived Node process. Holds an FSM (`idle/sup-running/dev-running/awaiting-*/paused/shutdown`), a message bus (sup↔dev inboxes), pending-question/approval registries, and the project state. Spawns the supervisor and developer Claude Code subprocesses one turn at a time (one-shot `claude -p` with `--resume <session-id>` for continuity).
- **Hook bridge** (`src/hooks/`) — Fastify HTTP server on a random localhost port. Bash hook scripts (`stop.sh`, `pretool.sh`, `prompt-inject.sh`) post the hook payload to the orchestrator and (for prompt/pretool) return the orchestrator's response back to Claude Code as JSON.
- **MCP bridge** (`src/mcp/`) — stdio MCP server that Claude Code spawns; it forwards `ask_user`, `request_user_approval`, and `write_phase_doc` tool calls to the orchestrator over HTTP.
- **Policy** (`src/orchestrator/policy.ts`) — pattern matcher for destructive Bash / sensitive file writes. Match → require approval; else → allow.
- **TUI** (`src/tui/`) — Ink (React for CLI). Two side-by-side panes, status bar, input bar; modals for questions/approvals.
- **Telegram bridge** (`src/telegram/`) — grammY long-poll. After 15 s of an unanswered on-screen prompt, escalates to the paired chat. Replies are routed back to the orchestrator.
- **State** (`src/project/`) — `.selfclaude/state.json` with phase + session ids + written phase docs. Detected on start; restored if present.

## Test layout

- `pnpm test` — fast unit tests (≈ 1 s) — parser, policy, FSM, message bus, signals, formatter, parser, telegram-bridge timer logic with a fake adapter, env helpers, project state.
- `pnpm test:integration` — live tests that spawn real `claude` subprocesses (≈ 20 s, costs API credits). Includes the dual-agent loop, hook bridge, ask_user round-trip, destructive gating, discovery flow, and resume.

## Troubleshooting

- `selfclaude doctor` — sanity-check env + Telegram reachability.
- `.selfclaude/orch.log` (if logging is configured) — JSON-line log of FSM transitions and hook events.
- "input disabled — stdin is not a TTY" — running outside a real terminal (CI, piped stdin). The TUI requires a TTY.
- Stale `.selfclaude/state.json` after a crash: delete it to start fresh.

## Status

All ten internal milestones are green:

| # | Milestone | What landed |
|---|-----------|-------------|
| M1 | Foundation skeleton | spawn wrapper, stream-json parser, CLI bin |
| M2 | Orchestrator core + Ink TUI shell | FSM, message bus, demo TUI |
| M3 | Hook bridge | Fastify, hook scripts, settings.json installer |
| M4 | Tag parsing + dual-agent loop | `<TASK_FOR_DEVELOPER>` extraction, sup↔dev round-trip |
| M5 | MCP server + ask_user | stdio MCP bridge, pending question registry |
| M6 | PreToolUse destructive op gating | policy matcher, approval registry |
| M7 | Discovery flow + supervisor system prompt | `write_phase_doc`, signal extractor, phase FSM transitions |
| M8 | State persistence + resume | `state.json`, project detect, session resume |
| M9 | Telegram bridge | grammY adapter, 15 s timeout, pairing-code link flow |
| M10 | Polish + smoke tests | real `selfclaude start` wiring, README |

89 unit tests + 9 integration tests, all green.


## Global Kullanım (düzenlenecek)
Komutlar (artık her yerden): 
 
selfclaude start# daemon olarak başlat, terminal serbest
selfclaude start --foreground # debug için inline (Ctrl+C exits) 
 
selfclaude stop # graceful kapat 
selfclaude restart# stop + start 
selfclaude status # çalışıyor mu 
 
selfclaude logs # son 100 satır log
selfclaude logs -f# canlı takip
selfclaude logs -n 500# son 500 satır
 
Senin için kullanım: 
cd ~/Developer/projects/SelfClaude && git pull 
selfclaude start# tarayıcı otomatik açılır, terminal sana döner
# … çalış …
selfclaude stop # işin bittiğinde
 
Önemli detay:
- PID file: ~/.selfclaude/run.pid
- Log file: ~/.selfclaude/run.log
- Stale PID otomatik temizlenir (process ölü ama dosya kalmışsa) 
- selfclaude stop 5sn graceful, sonra SIGKILL