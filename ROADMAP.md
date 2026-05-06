# SelfClaude — Roadmap & Phase Plan

> Single source of truth for what's next. Read this before opening a new
> branch. Update it when a phase ships, when sequencing changes, or when
> we learn something that invalidates an assumption.
>
> Maintained by: badursun
> Last revised: 2026-05-06 (post-v0.0.1 strategy session)

---

## 1. Where we stand

- **v0.0.1 shipped (2026-05-06).** Public repo, install.sh, MIT, CI.
- **What works:** sup + developer/ui-dev/security agents, Web UI with
  tabs + chat + dev timeline + tool detail + drawer, hook-based
  question/approval flow, chat-log persistence, recents + pinned,
  optional Telegram + Chrome verification, MCP integrations.
- **Test baseline:** 189 unit + 9 integration, all green.
- **What it isn't yet:** a *product*. PoC works for the author; not yet
  reliably reproducible for arbitrary users on arbitrary repos.

The gap from "PoC that works for me" → "tool people actually adopt"
is **control + trust + speed + repeatability**, in that order. Not AI
quality. The model is good enough; the system around it is not yet
predictable enough.

---

## 2. North star

> *"Sen yönlendir, agent'lar yapsın, sup denetlesin."*
>
> Multi-agent orchestration for software work — operator-in-the-loop,
> verifiable, recoverable, measurable.

Three things every release must protect:

1. **Determinism** — same input → same shape of output.
2. **Trust** — every change reviewable, reversible, attributable.
3. **Proof** — measurable time saved vs manual work.

Anything that doesn't move one of these forward goes to the bottom of
the stack.

---

## 3. Strategic priorities (ordered)

| # | Priority           | Why it's #N                                                        |
|---|--------------------|--------------------------------------------------------------------|
| 1 | Determinism        | If sup is unpredictable, nothing else matters.                     |
| 2 | Proof (telemetry)  | Without numbers, no adoption. Cheapest leverage we have.           |
| 3 | First-touch UX     | If the first 5 minutes don't click, no one tries the second time.  |
| 4 | Cost / context     | Current loop is expensive. Will block real-world long sessions.    |
| 5 | Trust (git iso)    | Users won't hand over the keyboard until rollback is one click.    |
| 6 | Audit / replay     | Trust v2: "what did it actually do, and why?"                      |
| 7 | Failure recovery   | Reliability story. Demos hide this; production exposes it.         |
| 8 | Role clarity       | Sharper agents, less overlap, fewer wrong-tool dispatches.         |
| 9 | Positioning        | Stop being mis-categorized as "another Claude wrapper."            |
|10 | Docker sandbox     | Re-evaluate after #5. May be unnecessary if branch iso is enough.  |

---

## 4. Phases

Each phase is sized to ship in one sprint (≈3–7 working days). Ship
one phase, measure, then start the next. **Do not stack phases in
parallel** — we already saw what scope creep does to focus.

### Phase 1 — Phase contracts (determinism foundation)

**Goal.** Sup phases produce structured, validated output. Same prompt,
same shape — every run.

**Background.** Today phases are markdown the sup writes freely. The
schema is implicit. Two runs of the same task produce two different
phase docs with different field names. That's the determinism leak.
Fix: make phases a **typed contract**, validated before
`<<PHASE_COMPLETE>>` is honored.

**Approach correction (calibration #1).** Pure schema rejection
without an example-driven path is going to fight the model and
deadlock. Real plan: **teach the pattern + retry loop**, not just
"reject and hope."
- Sup prompt carries a *worked exemplar* of each contract (concrete,
  not abstract).
- On validation failure, sup gets a structured "here's what you
  missed" message and retries — **same turn**, up to N attempts.
- Only after N retries do we surface the failure to the operator.
- Track first-pass rate as a metric, not a gate.

**Tasks.**
- 1.1 Define `PhaseContract` zod schema: `name`, `requiredFields[]`,
  `validators`, `outputSchema`.
- 1.2 Convert existing phase tracker output to contract format
  (research / plan / build / verify each get a contract).
- 1.3 Sup system prompt: explicit "you MUST output these keys" *plus
  one fully-worked exemplar per contract* (concrete, not abstract).
- 1.4 Server-side validation: on failure, return a structured
  rejection + retry the **same** turn. Retry limit is
  **configurable per contract** (default 3, tuned upward for
  contracts that empirically need more — never hard-coded).
- 1.5 Track first-pass rate, retry rate, ultimate-pass rate per
  contract — feeds into Phase 2 telemetry.
- 1.6 Web UI: phase progress card showing contract fields (filled vs
  pending) and retry indicator if applicable.
- 1.7 Operator override: explicit "accept-as-is" button for cases
  where contract is wrong, not the output.

**Tests.**
- Unit: schema accepts valid output, rejects each missing field.
- Unit: rejection message is structured (machine-readable + human
  hint).
- Unit: retry loop respects max attempts; surfaces final failure.
- Unit: operator override bypasses validation, logs as override.
- Integration (live): same prompt → 5 runs, measure first-pass
  rate (not gate, **measure**).
- Snapshot: contract docs serialise stably (no field reordering).

**Success criteria (revised, honest).**
- First-pass rate **≥60% baseline** at sprint start, **≥80% by
  sprint end** after exemplar tuning.
- Ultimate-pass rate (after retries) **≥95%**.
- Two runs of the same prompt produce phase docs with the **same
  set of keys** (values may differ) ≥90% of runs.
- 0 cases where retry loop deadlocks (always either passes or
  surfaces to operator within N attempts).

**Open questions.**
- Hard-block or soft-warn? Default = hard. Revisit after Sprint 1.
- Should contracts be per-project (overridable) or global only? MVP =
  global only.

---

### Phase 2 — Time-saved telemetry

**Goal.** Auto-measure value, surface it in the UI. Lowest effort,
highest leverage. Without numbers, no proof. Without proof, no
adoption.

**Approach correction (calibration #2).** "Estimated time saved"
without context is a number people stop trusting the moment it
feels off. Show **raw metrics first**, estimates clearly second
and clearly *labelled* as estimates. Let the user do the
math — that's more credible than any number we invent.

**Tasks.**
- 2.1 Per-session metrics collector: turns, wallclock duration, files
  modified, lines added/removed, tests added, tests passing,
  tool calls by kind, retries, tokens used.
- 2.2 Persist to `<cwd>/.selfclaude/metrics.json` (append-only events,
  derived rollup on read).
- 2.3 Web UI: session header shows **raw counters** (turns / files /
  tests / duration) prominently. No estimates here.
- 2.4 Project landing card: secondary "estimate" panel — explicitly
  badged "Estimate (3× baseline)" with the assumption visible and
  the raw inputs one click away.
- 2.5 Configurable baseline ratio (default 3×, user can set 1×–10×
  or disable estimate entirely).
- 2.6 `/api/sessions/:id/metrics` endpoint for export / sharing.
- 2.7 Optional: anonymized opt-in usage telemetry posted to a public
  metrics bucket (later — needs explicit consent flow).

**Tests.**
- Unit: counter increments correctly for each event kind.
- Unit: persistence round-trip.
- Unit: time-saved calculation respects baseline + bounds.
- E2E: open session, send 3 messages, counters match expected
  values.

**Success criteria.**
- User can answer "how long did SelfClaude save me this week?"
  without opening a stopwatch.
- Numbers shown match independent observation within ±10%.

---

### Phase 3 — Quickstart demo

**Goal.** First-time user gets a "this actually worked" moment in
under 5 minutes — without writing a prompt themselves.

**Approach correction (calibration #3).** A scaffolded TODO CLI is
*not* impressive. The demo has to produce something **visible and
tangibly real** — a working UI page, a callable API endpoint, a
generated artifact the user can open in a browser or hit with curl.
"Scaffolded files in a folder" is not the wow moment.

**Tasks.**
- 3.1 Demo template options (pick best after prototype):
  - **Option A (preferred):** mini Next.js page with a working
    interactive component — opens in browser at end, user can
    click and see it work.
  - **Option B:** small Express/Fastify API + `curl` example —
    user hits endpoint, sees real JSON response.
  - **Option C:** static site generator with content + theme —
    opens in browser, looks polished.
- 3.2 First-launch detection: empty recents + empty pinned → show
  demo CTA front-and-center.
- 3.3 One-click flow: temp dir + pre-loaded prompt + auto-run +
  open result in browser/terminal at the end.
- 3.4 Completion screen: "here's what sup did, here's the diff, here
  are the metrics, here's the running thing, want to try a real
  project?"
- 3.5 Skippable onboarding tour overlay (3 callouts max).

**Tests.**
- Unit: demo template loader resolves correctly across OS variants.
- E2E: fresh install → click demo → completes successfully in <5 min
  on reference machine.
- Manual: 3 first-time users, observe time-to-aha.

**Success criteria.**
- First-time user reaches "it worked" without writing a prompt.
- 5-minute median first-success time.

---

### Phase 4 — Context efficiency

**Goal.** Cut sup token usage by 50% on long sessions. Faster turns,
lower cost, no degradation in decision quality.

**Approach correction (calibration #4).** *Decisions never
disappear.* Compress everything else aggressively, but the
decision chain stays whole. If sup forgets a decision, every
downstream choice cascades into nonsense — and we won't see it
until the user is already pissed off.

**Invariants (non-negotiable):**
1. Every committed *decision* (phase choice, delegation, approval,
   accept/discard) is preserved verbatim in sup's working memory
   for the lifetime of the session.
2. Pending items (questions, approvals, todos) preserved verbatim.
3. Everything else — tool-call bodies, agent chatter, intermediate
   reasoning — is fair game for compression.
4. Chat-log is authoritative: nothing is *lost*, only deferred from
   sup's active context. Always reconstructable.

**Tasks.**
- 4.1 Sup memory layer: structured state — `decisions[]`,
  `pendingItems[]`, `phaseStatus`, `keyFileRefs[]`. These are
  preserved verbatim across turns.
- 4.2 DEVELOPER_REPORT summarisation: long reports compressed before
  injection. Compressor must extract any *decisions* embedded in the
  report into `decisions[]` first; only narrative is summarised.
- 4.3 Phase doc references via short IDs (`@phase-3`) instead of full
  body inlined into every prompt.
- 4.4 Tool-call detail pruning: after N turns, keep call signatures
  but drop verbose result bodies (still in chat-log, retrievable on
  demand).
- 4.5 Token budget tracker per session, soft-warn at 70%, hard-cap at
  configurable ceiling.
- 4.6 **Decision-preservation test suite**: regression corpus where
  any compression step that loses a decision fails the test.

**Tests.**
- Unit: summariser preserves all decisions and pending items
  (validated against fixture corpus).
- Unit: pruning preserves references — no dangling IDs.
- Integration: 30-turn session — token usage measured before/after
  this phase ships, target -50%.
- Regression: end-to-end task quality on standard suite unchanged.

**Success criteria.**
- 30+ turn session uses <50% of pre-phase token count.
- No regression on standard task suite (Phase 1 contract pass rate
  holds).

---

### Phase 5 — Git branch isolation (trust layer v1)

**Goal.** Every session lives on its own branch. User can roll the
whole thing back with one click. No more "uh, what did sup just
delete?"

**Approach correction (calibration #5).** Per-phase commits are
clean to look at but useless for debugging. Per-turn commits are
detailed but noisy. Hybrid is the only honest answer:
**commit per turn, squash to per-phase on accept** (with a debug
flag that keeps full granularity).

**Tasks.**
- 5.1 Session start auto-creates branch `selfclaude/<session-id>`
  from current HEAD.
- 5.2 Commit per turn (fine-grained, noisy, debuggable). Each
  commit message includes turn index + agent + summary.
- 5.3 On "Accept": squash to one commit per phase by default;
  `--keep-granular` flag preserves per-turn commits if requested.
- 5.4 Web UI: session header shows branch name, commit count, files
  changed; "view granular history" toggle.
- 5.5 Drawer: per-commit diff preview.
- 5.6 "Accept" button → merge to user's working branch (configurable
  strategy: merge / squash / rebase; squash default).
- 5.7 "Discard" button → delete branch, restore worktree.
- 5.8 Optional (Phase 5b): per-agent worktree for parallel agents
  that touch the same files.

**Tests.**
- Unit: branch lifecycle (create, commit, merge, discard).
- Unit: discard truly removes work — worktree pristine, no dangling
  refs.
- Integration: parallel agents in separate worktrees don't conflict.
- E2E: full session → discard → `git status` clean, `git branch`
  clean.
- Chaos: kill server mid-commit → next start recovers cleanly.

**Success criteria.**
- "Discard" leaves repo bit-identical to pre-session state.
- User can run a risky session on a real repo without fear.
- 0 cases of orphan commits or zombie branches across 50 test runs.

---

### Phase 6 — Replay & audit

**Goal.** "What did it do at 3pm yesterday, and why?" answerable in
30 seconds.

**Approach correction (calibration #6).** Most users (~80%) won't
actively scrub through replay. This is a **trust-signalling**
feature: its presence is the value. So: ship the *minimum
trustworthy* replay — don't gold-plate it. Save effort for Phase 5
and Phase 7, which the same users will hit constantly.

**Tasks (right-sized).**
- 6.1 Chat-log replay UI: scrubbable timeline of past session
  (basic linear scrubber — not a multi-track editor).
- 6.2 Per-turn diff view (file before/after, agent that did it,
  sup justification).
- 6.3 Decision trail panel: each delegation, each approval decision
  with timestamp + reason.
- 6.4 Read-only mode: opening a past session can't resume / mutate.
- 6.5 Session report export: single markdown file, shareable.

**Deferred (don't build in Phase 6 unless user feedback demands):**
- ~~Search across all sessions~~ → Phase 6b if users actually ask.
- ~~Diff syntax highlighting beyond basic +/-~~ → Phase 6b.
- ~~Side-by-side timeline comparison~~ → never, probably.

**Tests.**
- Unit: chat-log parser handles every event kind.
- Unit: diff generator across file kinds (text, JSON, lockfiles).
- Unit: read-only enforcement prevents mutation paths.
- E2E: open historical session, scrub through, see every state
  change in order.

**Success criteria.**
- Any past decision is auditable in <30 seconds.
- Exported report is readable by a human who didn't run the session.

---

### Phase 7 — Failure handling

**Goal.** Errors are recoverable, surface clearly, and don't lose
work.

**Tasks.**
- 7.1 Sup self-recovery protocol: on agent failure, sup decides
  retry / skip / escalate based on failure class.
- 7.2 Failure mode catalog: standard responses for tool error, agent
  timeout, context overflow, hook validation failure, network
  error, MCP server crash.
- 7.3 "Stuck" detection: no progress (no new file change, no new
  decision) in N turns → sup nudges user.
- 7.4 Crash recovery: server restart preserves session state via
  chat-log replay; sup catches up.
- 7.5 SSE error boundary in web UI: drop → reconnect with backoff +
  full state resync.
- 7.6 Standardized error UI: "what happened, what can you do, where
  to look for more."

**Tests.**
- Unit: failure dispatch picks correct recovery for each catalogued
  failure class.
- Chaos: kill agent mid-tool-call → recovery completes the work.
- Chaos: kill server mid-session → restart resumes.
- Integration: SSE drop & reconnect → no event loss visible to
  operator.
- E2E: induce each failure class, observe correct UX.

**Approach correction (calibration #7).** "<5% unrecovered failure"
is fantasy. AI in real production sees **10–15% failure rate**
under realistic loads. Be honest about this in our metrics, in our
docs, in our user expectations. Hiding the rate doesn't make it
disappear; it just makes users feel betrayed when they hit it.

**Success criteria (revised, honest).**
- **<10% unrecovered failure** across 100 test runs (target;
  measure and publish even when worse).
- Failure rate is **publicly visible** in telemetry — both to the
  user (per-session) and aggregate (project rollup).
- 0 cases of "lost work" — chat-log + git branch always
  recoverable. *This one is non-negotiable.*
- Every failure has a catalogued mode (no "unknown error" buckets
  larger than 5% of failures).

---

### Phase 8 — Agent role clarity

**Goal.** Sharper roles, no overlap, clear delegation rubric. Two
new specialists where there are real gaps. **Then stop.**

**Approach correction (calibration #8).** Each new agent multiplies
complexity: more delegation paths, more contracts, more failure
modes, more places sup can pick wrong. We add **two and only two**
new agents in v1.0: tester and refactorer. After that, **hard cap**
— no more agents in core until we have data showing existing roster
is insufficient. New roles via plugins (Phase 8b, post-v1.0).

**Tasks.**
- 8.1 Audit current roster (developer, ui-dev, security): overlap
  analysis with sample task corpus.
- 8.2 Capability matrix: explicit "should do / shouldn't do" per
  agent.
- 8.3 Sup prompt: delegation rubric (decision tree based on task
  shape).
- 8.4 New agent: **tester** — verification-only, no production code.
- 8.5 New agent: **refactorer** — bounded scope, no new features, no
  new dependencies.
- 8.6 **Hard cap commitment:** no further agents in core for v1.0.
  Document this rule in CONTRIBUTING and decline PRs that add new
  agents until plugin system exists.
- 8.7 Decide: plugin system design (post-v1.0 sketch only —
  *don't build it in this phase*).

**Tests.**
- Integration: each role activates only on right task class (test
  corpus of 20+ tasks).
- Live: capability matrix prevents wrong-agent dispatch (manual
  review of 20 sessions).

**Success criteria.**
- 0 cases of "sup picked clearly wrong agent" in 20 reviewed
  sessions.
- New agents (tester, refactorer) demonstrably faster on
  matched tasks vs developer doing same work.
- v1.0 ships with **exactly 5 agents**: developer, ui-dev,
  security, tester, refactorer. No more.

---

### Phase 9 — Positioning & docs

**Goal.** Stop being mis-read as "another Claude wrapper." Tell the
real story. Show the data from Phase 2.

**Approach correction (calibration #9).** README's job is **not**
to inform — it's to make the reader **decide**. Most visitors are
skimming for "should I install this or not?" If we give them a
spec sheet, they bounce. If we give them a decision rubric, they
either install or self-select out (which is also fine).

**The first 5 lines rule.** People don't read READMEs. They scan
the top, decide in 5 seconds, and either keep reading or close
the tab. The first 5 lines have to do *all* the work: hook,
value, decision. Everything below them is for the people who
already half-decided.

**Tasks.**
- 9.1 README hero rewrite: **first 5 lines are sacred** — 1-line
  hook + 1-line value prop + 3-line decision rubric ("install if
  you ___ / skip if you ___"). Iterate on these 5 lines like
  copywriting, not docs. Test on 3+ unfamiliar readers before
  shipping.
- 9.2 "Why not just Claude Code?" section — honest comparison.
- 9.3 Use-case gallery: 3–5 real scenarios with timing data
  (sourced from Phase 2 telemetry — real numbers, not guesses).
- 9.4 Architecture diagram (clean, link-shareable).
- 9.5 Demo video: <2 min, real session, real result, no edits.
- 9.6 Optional: landing page (separate from GitHub).
- 9.7 Update package.json description / topics to match positioning.
- 9.8 Front-of-README "Is this for me?" decision tree (3 questions
  max, honest answers).

**Tests.** N/A (content review).

**Success criteria.**
- New visitor articulates the value prop in <30 seconds after
  landing on README.
- Zero "wait, isn't this just X?" comments in first 50 issues.

---

### Phase 10 — Docker sandbox (probably won't ship)

**Goal.** *Maybe* full container isolation for high-risk environments.
**Strong default: don't build this.** Phase 5 (branch isolation +
diff + accept/discard) covers ~95% of the trust surface. Docker
adds complexity (compose, volumes, network policy, sync on accept)
that becomes a maintenance tax forever. Only revisit if real users
ask for it after v1.0 ships, and even then start with "what's
actually missing from Phase 5?" not "let's add docker."

**Tasks (only if still justified).**
- 10.1 Decision review: do users still ask for it after Phase 5?
- 10.2 If yes: docker-compose template per session.
- 10.3 Volume mounts read-only by default; agents write to staging
  layer.
- 10.4 Network policy: agents reach only declared services.
- 10.5 `selfclaude start --sandbox` flag.
- 10.6 Volume sync strategy on accept (Phase 5 merge integration).

**Tests.**
- Integration: sandboxed agent cannot escape (filesystem, network).
- E2E: full session in sandbox, accept merges cleanly to host repo.

**Success criteria.**
- User can run an *untrusted* prompt without fear of host damage.

**Risk.** 2-week effort. Don't start unless Phase 5 trust gap is
demonstrably insufficient.

---

## 5. Sequencing

| Sprint | Phase | Effort      | Outcome shipped                       |
|--------|-------|-------------|----------------------------------------|
| 1      | 1     | ~1 wk       | Determinism foundation                 |
| 2      | 2     | ~4 days     | Telemetry — first numbers              |
| 3      | 3     | ~4 days     | Onboarding 5-min aha                   |
| 4      | 4     | ~1 wk       | Halved token cost                      |
| 5      | 5     | ~1.5 wk     | Trust v1 (git branch isolation)        |
| 6      | 6     | ~1 wk       | Audit / replay                         |
| 7      | 7     | ~1 wk       | Failure recovery                       |
| 8      | 8     | ~1 wk       | Role clarity + new agents              |
| 9      | 9     | ~4 days     | Positioning & launch-ready docs        |
| 10     | 10    | (decide)    | Sandbox if still needed                |

**Total to v1.0:** ~10–12 weeks at one-phase-per-sprint cadence.

**Cadence rule:** ship → measure for 3–5 days → start next. Don't
stack. If a phase blows out, *cut scope*, don't extend the sprint.

---

## 6. Cross-phase concerns (always-on)

### Stability
- Every phase: full test suite (unit + integration) green before
  merge.
- Integration test count target: **20+ live tests by end of Phase
  5**.
- CI catches regressions automatically. No manual gating.

### Cost
- Track token usage of *our own* development sessions (eat dog
  food).
- Avoid re-implementing what already works. Audit before refactor.

### Documentation
- Each phase ships with:
  - `CHANGELOG.md` entry (terse, user-facing).
  - README updates if surface changed.
  - One-paragraph postmortem in `docs/postmortems/<phase>.md` —
    what we learned, what surprised us, what we'd do differently.
- Architecture decisions in `docs/decisions/NNN-<title>.md` (ADR
  format, lightweight).

### Telemetry / dogfooding
- Once Phase 2 ships, every dev session of *SelfClaude itself* feeds
  telemetry. Use the data to drive Phase 4+ priorities.

---

## 7. Definition of v1.0

- Phases **1–7** shipped (8–10 are stretch).
- 50+ external users with *measurable* time-saved data (Phase 2
  telemetry, opt-in shared).
- 0 known critical bugs (security, data loss, hung sessions).
- Documentation complete: README, use-cases, architecture diagram,
  demo video.
- v1.0 release notes ready to publish.

---

## 8. What we explicitly are *not* doing (yet)

To stay focused, the following are **out of scope** for v1.0 unless
they become blockers:

- IDE plugins (VS Code, JetBrains).
- Cloud-hosted version (always self-hosted local-first).
- Team / multi-user features (this is single-operator until proven).
- Plugin / marketplace for third-party agents (core agents only).
- Mobile UI polish (responsive baseline only, no native apps).
- Enterprise auth / SSO / RBAC.
- Non-Claude model backends.

If any of these come up, write a "future" memory entry, don't pull
forward.

---

## 9. Open decisions waiting on data

These need answers before we start the relevant phase. Don't
pre-decide; wait for telemetry or user feedback.

| Decision                                    | Phase | Resolves on                          |
|---------------------------------------------|-------|---------------------------------------|
| Phase contracts: hard-block or soft-warn?   | 1     | First week of Phase 1 dogfooding      |
| Auto-commit granularity (turn vs phase)?    | 5     | Phase 5 prototype + 3 sample sessions |
| Replay UI: scrubber or step-through?        | 6     | Quick UX prototype, A/B feel test     |
| New agents (tester, refactorer): plugin?    | 8     | Plugin demand from external users     |
| Docker sandbox: still needed after Phase 5? | 10    | Issue tracker + user interviews       |

---

## 10. How to use this file

- **Before starting a phase:** read its section end-to-end, including
  open questions. If a question can't be answered yet, capture the
  blocker and pick the next ready phase.
- **During the phase:** update its task list with `[x]`, capture new
  open questions inline, don't let scope creep into other phases.
- **After shipping a phase:** move it to a "Done" section at the
  bottom (with ship date), write the postmortem, then start the
  next.
- **When priorities change:** edit Section 3 + 5 explicitly. Don't
  silently reorder. Note the date and reason.

This document is the spine. Everything else (tickets, branches,
chat) hangs off it.

---

## 11. Calibration log

This section records *why specific numbers and approaches changed*
from the first draft. Future-you (or a contributor) wondering
"why is the success target 60% instead of 95%?" should find the
answer here.

### 2026-05-06 — initial draft (v0)

First-pass roadmap written post-v0.0.1 strategy session. Numbers
were aspirational rather than evidence-based. Approach in several
phases assumed more model-controllability than is realistic.

### 2026-05-06 — calibration pass (v1, current)

Operator review surfaced nine over-confident assumptions. Each was
folded back into the relevant phase as an "Approach correction"
block. Summary of revisions:

1. **Phase 1 — contracts.** Dropped "95% first-pass" target.
   Replaced hard schema rejection with *worked exemplars + retry
   loop*. New baseline: 60% first-pass start, 80% sprint end, 95%
   ultimate-pass after retries. Source of correction: schema-only
   approach fights the model and deadlocks; teaching the pattern
   works better.

2. **Phase 2 — telemetry.** "Estimated time saved" demoted to a
   secondary, clearly-labelled panel. Raw counters now primary.
   Source of correction: invented numbers destroy trust the moment
   they feel off; raw numbers don't have that failure mode.

3. **Phase 3 — quickstart demo.** TODO CLI replaced with a
   *visible artifact* (preferred: Next.js page; fallbacks: API
   endpoint, static site). Source of correction: scaffolded files
   in a folder don't produce the wow moment.

4. **Phase 4 — context.** Added explicit invariant: *decisions are
   never compressed away*. Added a decision-preservation test
   suite. Source of correction: losing a decision cascades into
   downstream nonsense; we won't see it until the user is already
   pissed off.

5. **Phase 5 — git isolation.** Default switched from per-phase
   commits to **per-turn with squash-on-accept** (hybrid). Source
   of correction: per-phase is unusable for debug; per-turn is
   noisy at review time; hybrid is the only honest answer.

6. **Phase 6 — replay.** Right-sized to "trust signalling, not
   active feature." ~80% of users won't actively scrub. Removed
   search, fancy diff, side-by-side comparison. Source of
   correction: don't gold-plate a feature most users won't open.

7. **Phase 7 — failure handling.** Target raised from <5% to
   <10% unrecovered failure (still aspirational; measure and
   publish even when worse). Failure rate is now publicly visible
   in telemetry. Source of correction: AI in production is
   10–15%; pretending otherwise breeds betrayed users.

8. **Phase 8 — agents.** Hard cap committed: v1.0 ships with
   **exactly 5 agents**. New agents post-v1.0 only via plugin
   system. Source of correction: agent count and quality have
   inverse correlation past a point; we have to draw the line.

9. **Phase 9 — positioning.** README reframed from spec sheet to
   *decision driver*. Added "Is this for me?" decision tree.
   Source of correction: README's job is to make the reader
   decide, not to inform.

10. **Phase 10 — docker.** Stance hardened from "re-evaluate" to
    "probably won't ship." Source of correction: Phase 5 covers
    ~95% of the trust surface; docker is forever maintenance tax.

If a future revision changes any of these, append a new dated
entry. Don't silently overwrite.

### 2026-05-07 — calibration pass (v1.1, current)

Two surgical refinements after operator review of v1:

11. **Phase 1 — retry config.** Hard-coded 3-retry cap risked
    deadlock on contracts that empirically need more attempts.
    Now per-contract configurable, default 3, tuned upward
    based on data — never hard-coded.

12. **Phase 9 — first 5 lines rule.** "Decision-driver README" is
    necessary but insufficient if the *first 5 lines* don't do
    the heavy lifting alone. Most readers never get past them.
    Promoted those 5 lines to a dedicated rule, with 3-reader
    test before shipping.

### Deferred / parked

- **Distribution plan.** Operator parked for after v1.0 ships.
  Will cover: install channels (brew, npm, install.sh), discovery
  (Show HN, X, dev forums), version cadence, telemetry feedback
  loops. Not a phase yet — this is *post-v1.0* go-to-market.
