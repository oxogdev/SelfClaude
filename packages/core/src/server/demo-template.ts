import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 3 of ROADMAP.md — Quickstart demo template.
 *
 * Pre-canned prompt + workspace shape that gives a first-time
 * operator an end-to-end "this actually worked" moment in under 5
 * minutes without writing a prompt themselves.
 *
 * Per ROADMAP calibration #3: the deliverable must be **visible and
 * tangibly real**. A single self-contained `index.html` opens
 * directly in the operator's browser — no build step, no install,
 * no dev server. Tailwind comes from a CDN, scripts are inline.
 *
 * The flow exercises every load-bearing piece of the system —
 * supervisor + developer delegation, phase-doc contract, phase
 * tracker, file write — but stays narrow enough that a typical run
 * takes 2-3 turns total.
 */

/** Filename of the artifact the demo produces. Used for the "Open Result" button. */
export const DEMO_ARTIFACT_FILENAME = 'index.html';

/** Subdir under home where every demo session's working directory lives. */
export const DEMO_ROOT_DIRNAME = 'demos';

/**
 * Compose the absolute path to a fresh demo workspace. Each demo gets
 * its own subdir keyed by timestamp so concurrent runs don't collide
 * and old ones can be inspected later (operator's choice when to
 * clean them out — we don't auto-delete).
 */
export function newDemoWorkspaceDir(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return join(homedir(), '.selfclaude', DEMO_ROOT_DIRNAME, `demo-${ts}`);
}

/**
 * Predicate: is this cwd a SelfClaude demo workspace? The frontend uses
 * this to gate the "Open Result" button — only demos get the
 * one-click open. For real projects the operator opens files via the
 * normal IDE / explorer.
 */
export function isDemoWorkspace(cwd: string): boolean {
  const demoRoot = join(homedir(), '.selfclaude', DEMO_ROOT_DIRNAME);
  // realpath comparison happens in the API handler — here we just
  // string-match the prefix to avoid spurious DB hits in the UI.
  return cwd.startsWith(demoRoot);
}

/**
 * The canned brief the operator sees auto-filled in the chat box on
 * the first turn. Tight, concrete, includes a stack lock so sup
 * doesn't ask onboarding questions, and explicitly asks for a single
 * file with no build step.
 *
 * Phrased to satisfy the Phase 1 phase-doc contract on first attempt:
 * the brief gives sup enough material to fill every required section
 * (Goal, Scope, Success Criteria, Verification, Out of Scope) without
 * inventing constraints.
 */
export const DEMO_PROMPT = `DEMO_BRIEF: Single-file portfolio landing page.

Skip discovery — the spec is locked:

- PROJECT_TYPE: marketing-site (single static HTML file)
- STACK: HTML + Tailwind via CDN + vanilla JS. NO build step. NO npm install. NO server. The deliverable is a single \`${DEMO_ARTIFACT_FILENAME}\` that the user double-clicks to open in their browser.
- CONSTRAINTS: hard. Do not add a package.json. Do not propose a dev server. Do not pull in React / Vue / any framework.

Sections to include in \`${DEMO_ARTIFACT_FILENAME}\`:
- **Hero** — name "Alex Demo", role "Software Engineer", one-line bio, plus a working dark/light theme toggle button (vanilla JS, persists choice in localStorage)
- **Skills** — 4–5 visual chips (TypeScript, Node.js, React, Postgres, Docker — choose any sensible 5)
- **Footer** — 3 placeholder social icons (use inline SVG or unicode glyphs; URLs can be \`#\`)

Quality bar: dark theme by default, generous spacing, readable typography, clear hierarchy. It must look like a finished page, not a wireframe.

Process:
1. Skip questions — the spec above is final.
2. Write \`docs/phases/01-portfolio.md\` via write_phase_doc satisfying the execution-phase-doc contract (Goal, Scope, Success Criteria, Verification, Out of Scope).
3. \`register_phase_items\` with one item: \`portfolio-html\` — "Portfolio index.html delivered, opens in browser, theme toggle works."
4. Delegate ONE \`<TASK_FOR_DEVELOPER>\` block to write \`${DEMO_ARTIFACT_FILENAME}\` per the spec. The developer should produce the complete file in a single turn.
5. After the developer's report, spot-check by reading the file — confirm sections exist + theme toggle script is wired in. Then \`confirm_item_done\` and emit \`<<PHASE_COMPLETE>>\` on a line by itself.

The user will open \`${DEMO_ARTIFACT_FILENAME}\` directly in their browser via a one-click button in the UI — make it look real.`;
