# Contributing to SelfClaude

Thanks for taking a look. SelfClaude is small + opinionated; the bar for additions is "does it make the multi-agent loop work better for the operator." Read this before sending a PR — there are a few spots where the project's design has hardened around explicit constraints, and matching those constraints is the difference between a quick merge and a long back-and-forth.

## Ground rules

- **Stay terse.** Code, prompts, commit messages, PR descriptions — all default to short. The codebase is read more than it's written; verbosity dilutes the signal.
- **Tests are not optional.** New surface ships with tests. Bug fixes ship with a regression test that pins the fix. The unit suite is fast (`pnpm test`) — there's no reason to skip it.
- **Honest scope.** Don't bundle a feature with a refactor with a typo fix. Three small PRs > one big one. The reviewer's job is easier when the diff has one purpose.
- **Be deliberate about prompt edits.** The system prompts (`packages/core/src/claude-code/system-prompts/*.md`) drive agent behaviour. A prompt change that "feels like a small wording tweak" can flip the agent's whole approach. Test by running a real session before sending the PR.

## What we'll merge

- Bug fixes with regression tests.
- UX polish on existing surfaces (clearer copy, better defaults, fewer modals).
- New features that fit the ROADMAP (`ROADMAP.md`) — coordinate with an issue first if it's substantial.
- Performance improvements with before/after numbers.
- Documentation additions that help operators get unstuck faster.

## What we'll bounce

- New built-in agents. **The roster is hard-capped at 6** for v1.0 (supervisor, developer, ui-dev, security, tester, refactorer). See "Hard-capped agent roster" below.
- New top-level dependencies without a clear case. The current dep tree is intentional.
- Architectural rewrites without a discussion thread first.
- Auto-formatting / lint sweeps that touch unrelated files. Keep diffs scoped.

## Hard-capped agent roster

ROADMAP calibration #8 commits v1.0 to **exactly five spawnable specialists** (six roles total including supervisor). Adding a seventh built-in agent gets bounced — not because the idea is bad, but because each new built-in multiplies the delegation surface (more contracts, more failure modes, more places sup can pick wrong).

**Current built-ins:**

| Role | Capability | When sup uses it |
|---|---|---|
| `supervisor` | Always-on lead | Plans, delegates, gates phases |
| `developer` | Backend / general | Default implementation target |
| `ui-dev` | Frontend specialist | shadcn/ui + Tailwind admin-panel work |
| `security` | Read-only auditor | Pre-PHASE_COMPLETE security pass |
| `tester` | Verification-only | After a feature lands, before next phase |
| `refactorer` | Bounded rework | Cleanup on a green codebase |

**If your contribution adds a 7th built-in agent, please don't.** The path forward is the **plugin system** (sketched in ROADMAP §10b, Phase 8b) — not yet implemented, but the contract will be: drop a config + system-prompt into `~/.selfclaude/agents.json` (user-global) or `<cwd>/.selfclaude/agents.json` (project-local), and the registry picks it up.

Until plugins ship, custom roles are best handled via the existing project-local override file (the loader is wired but the surface is minimal). PRs that add built-in roles to `BUILTIN_AGENTS` in `packages/core/src/agents/registry.ts` will be closed with a pointer back here.

Exceptions: a PR that *replaces* an existing agent (e.g. a substantially better tester prompt) is welcome. The cap is on *roster size*, not on iteration.

## Working with the codebase

```bash
# Setup
pnpm install

# Run from source (web + API)
pnpm dev

# Type-check both packages
pnpm typecheck

# Unit tests (fast)
pnpm test

# Integration tests (slow — spawns real CC subprocesses, costs API credits)
pnpm test:integration
```

The web app talks to the core API on `127.0.0.1:7423`. The dev script runs both side-by-side; production ships as a single Node process.

## Commit + PR style

- One concern per commit when practical. Squash-on-merge is fine if your branch has noisy intermediate commits.
- Commit messages: terse subject (under 72 chars), wrapped body explaining *why*. Match the style in `git log --oneline` — recent commits (the Phase N sprint X format) are the template.
- PR descriptions: what changed, why, how you tested. Screenshots for UI changes are great. Don't bury the lede.

## Reporting bugs

Open an issue with: SelfClaude version, reproduction steps, expected vs actual, and (if applicable) the chat-log entry that triggered the bug. The chat-log lives at `<your-project>/.selfclaude/chat-log.jsonl` — paste the relevant lines verbatim.

## Reporting security issues

Don't open public issues for security-sensitive bugs. Email the maintainer directly (badursun@gmail.com) with the details. We'll triage privately.
