/**
 * Phase document contracts — Phase 1 of ROADMAP.md (Determinism).
 *
 * The supervisor writes Markdown briefs into `<cwd>/docs/phases/*.md`
 * for each execution slice. Without a contract, every run produces a
 * differently-shaped doc — different headings, different rigor, different
 * gaps. That non-determinism cascades: specialists read these briefs
 * and operate on whatever's there, so an inconsistent brief produces
 * inconsistent execution.
 *
 * A `PhaseContract` declares the *structure* a phase doc must follow —
 * required sections, minimum bullet counts, minimum word counts. The
 * contract carries a worked exemplar so when validation fails, sup gets
 * a concrete, copyable example back along with the structured error.
 *
 * Validation is enforced at the MCP boundary (`write_phase_doc`): if a
 * doc fails, the MCP call throws, sup sees the error in its context,
 * and naturally retries. No special retry plumbing needed — MCP error
 * handling already gives us the loop for free.
 *
 * Per the ROADMAP calibration: this is teach-the-pattern, not
 * fight-the-model. The exemplar is the teaching tool; rejection alone
 * deadlocks. Retries are capped per contract (configurable, never
 * hard-coded); after the cap, sup must surface to the operator via
 * `ask_user` and proceed only with explicit override.
 */

export interface PhaseContractSection {
  /** Stable identifier — used in telemetry + error messages. */
  id: string;
  /**
   * Heading text the doc must contain. Match is case-insensitive and
   * lenient: `## Goal`, `### Goal`, `## Goal:`, `## Goal & Outcome`
   * all match `title: 'Goal'`. `## Goals` does NOT match — different
   * word.
   */
  title: string;
  /** Required sections drive validation. Optional sections are documented but not enforced. */
  required: boolean;
  /** Minimum bullet points (lines starting with `-`, `*`, or `+`). */
  minBullets?: number;
  /** Minimum word count inside the section body (excludes heading). */
  minWords?: number;
}

export interface PhaseContract {
  /** Contract name — used in telemetry and error messages. */
  name: string;
  /** Short description shown in the retry message header. */
  description: string;
  /** Predicate: does this contract apply to this phase doc filename? */
  appliesTo: (filename: string) => boolean;
  /** Sections the contract enforces. */
  sections: PhaseContractSection[];
  /**
   * Worked exemplar — a fully-fleshed example of a doc that passes
   * the contract. Shown to sup on validation failure so the model can
   * pattern-match against a concrete reference instead of abstractly
   * reasoning about the schema.
   */
  exemplar: string;
  /**
   * Maximum retry attempts before surfacing an override-required
   * error. Configurable per contract (never hard-coded — some
   * contracts may empirically need more attempts than others).
   */
  defaultRetryLimit: number;
}

export type ContractViolationRule =
  | 'missing-section'
  | 'too-few-bullets'
  | 'too-few-words';

export interface ContractViolation {
  sectionId: string;
  rule: ContractViolationRule;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  violations: ContractViolation[];
  /** Required section ids that were found in the doc. */
  sectionsFound: string[];
  /** Required section ids that are missing. */
  sectionsMissing: string[];
}

/* ───── Markdown parsing helpers ───── */

interface ParsedSection {
  heading: string;
  body: string;
}

/**
 * Parse h2/h3/h4 sections from markdown. Lines before the first
 * heading are dropped (intro paragraphs). Anything after the last
 * heading belongs to that section.
 */
function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      sections.push({ heading: currentHeading, body: currentBody.join('\n') });
    }
  };

  for (const line of lines) {
    const m = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentHeading = m[1] ?? '';
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  flush();
  return sections;
}

function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lenient heading match. The contract title "Goal" matches a doc
 * heading whose normalized text equals "goal" or starts with "goal "
 * (so "Goal & Outcome" matches but "Goals" does not).
 */
function headingMatches(contractTitle: string, docHeading: string): boolean {
  const c = normalizeHeading(contractTitle);
  const d = normalizeHeading(docHeading);
  return d === c || d.startsWith(`${c} `);
}

function countBullets(body: string): number {
  return body.split('\n').filter((l) => /^\s*[-*+]\s+\S/.test(l)).length;
}

function countWords(body: string): number {
  return body.split(/\s+/).filter((w) => w.length > 0).length;
}

/* ───── Validation ───── */

export function validatePhaseDoc(
  body: string,
  contract: PhaseContract,
): ContractValidationResult {
  const sections = parseSections(body);
  const violations: ContractViolation[] = [];
  const sectionsFound: string[] = [];
  const sectionsMissing: string[] = [];

  for (const required of contract.sections) {
    const matched = sections.find((s) => headingMatches(required.title, s.heading));
    if (!matched) {
      if (required.required) {
        sectionsMissing.push(required.id);
        violations.push({
          sectionId: required.id,
          rule: 'missing-section',
          message: `Required section "${required.title}" is missing. Add a heading like "## ${required.title}" with content underneath.`,
        });
      }
      continue;
    }

    if (required.required) sectionsFound.push(required.id);

    if (required.minBullets !== undefined) {
      const found = countBullets(matched.body);
      if (found < required.minBullets) {
        violations.push({
          sectionId: required.id,
          rule: 'too-few-bullets',
          message: `Section "${required.title}" has ${found} bullet point(s); needs at least ${required.minBullets}. Use \`- \` to start each bullet.`,
        });
      }
    }

    if (required.minWords !== undefined) {
      const found = countWords(matched.body);
      if (found < required.minWords) {
        violations.push({
          sectionId: required.id,
          rule: 'too-few-words',
          message: `Section "${required.title}" has ~${found} word(s); needs at least ${required.minWords}. Write a fuller paragraph (the brief must stand on its own).`,
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    sectionsFound,
    sectionsMissing,
  };
}

/**
 * Build the structured error message that gets returned to sup as the
 * MCP error body. Lists every violation, points at which sections to
 * fix, and includes the worked exemplar so sup has a concrete pattern
 * to follow on the retry.
 */
export function buildRetryMessage(
  result: ContractValidationResult,
  contract: PhaseContract,
  attemptNumber: number,
): string {
  const parts: string[] = [];
  parts.push(
    `Phase doc validation failed (attempt ${attemptNumber} of ${contract.defaultRetryLimit}). Contract: ${contract.name}.`,
  );
  parts.push('');
  parts.push(contract.description);
  parts.push('');
  parts.push('Issues:');
  for (const v of result.violations) {
    parts.push(`  - ${v.message}`);
  }
  parts.push('');
  parts.push(
    'Re-call write_phase_doc with the SAME filename and a corrected body. The correction must address every issue above.',
  );
  parts.push('');
  parts.push('Worked exemplar — model your structure on this:');
  parts.push('');
  parts.push('---');
  parts.push(contract.exemplar);
  parts.push('---');
  return parts.join('\n');
}

/**
 * Build the "max retries exhausted" message. Sup must stop hammering
 * and surface to the operator.
 */
export function buildOverrideRequiredMessage(
  result: ContractValidationResult,
  contract: PhaseContract,
  attemptNumber: number,
): string {
  const parts: string[] = [];
  parts.push(
    `Phase doc validation has failed ${attemptNumber} times for contract "${contract.name}" (cap: ${contract.defaultRetryLimit}).`,
  );
  parts.push('');
  parts.push('Stop retrying. Either:');
  parts.push(
    '  1. Ask the operator (`ask_user`) to confirm the doc is acceptable as-is, then re-call write_phase_doc with `override: true`.',
  );
  parts.push(
    '  2. Step back and rethink — maybe the contract violations point at a real gap in the brief that you should address.',
  );
  parts.push('');
  parts.push('Outstanding violations:');
  for (const v of result.violations) {
    parts.push(`  - ${v.message}`);
  }
  return parts.join('\n');
}

/* ───── Bundled contracts ───── */

/**
 * Overview phase doc — the project-level brief at `00-*.md`. This is
 * orientation for every agent that touches the project, so it must
 * cover scope edges, stack, and out-of-scope items explicitly.
 */
export const OVERVIEW_CONTRACT: PhaseContract = {
  name: 'overview-phase-doc',
  description:
    'The overview brief is the project anchor — every agent reads it first. It must declare the goal, the locked stack, the MVP scope edges (what is in, what is out), the success criteria, and the known risks.',
  appliesTo: (filename) => /^00[\W-]/i.test(filename) || /^overview/i.test(filename),
  sections: [
    { id: 'goal', title: 'Goal', required: true, minWords: 25 },
    { id: 'stack', title: 'Stack', required: true, minBullets: 2 },
    { id: 'mvp-scope', title: 'MVP Scope', required: true, minBullets: 3 },
    { id: 'out-of-scope', title: 'Out of Scope', required: true, minBullets: 1 },
    { id: 'success-criteria', title: 'Success Criteria', required: true, minBullets: 2 },
    { id: 'risks', title: 'Risks', required: true, minBullets: 1 },
  ],
  defaultRetryLimit: 3,
  exemplar: `# Phase 00 — Overview

## Goal

Build a multi-tenant invoicing dashboard where small business owners can issue, track, and reconcile invoices. The MVP targets a single operator per tenant with email-based delivery; payment integration is a follow-on.

## Stack

- Frontend: Next.js 15 (app router) + Tailwind v4 + shadcn/ui
- Backend: Fastify on Node.js 22 + Postgres 16 (Prisma ORM)
- Auth: NextAuth.js with email magic links
- Hosting: Fly.io for app, Neon for managed Postgres

## MVP Scope

- Operator can create / edit / list invoices with line items + tax
- Invoice PDFs render server-side and email to customer
- Read-only audit log of who-did-what (operator actions only)
- Settings: tenant profile, tax rate, payment terms

## Out of Scope

- Payment processing (Stripe / Paddle integration is a Phase 2 feature)
- Customer self-serve portal (no customer login in MVP)
- Multi-currency / FX handling — single-currency per tenant
- Mobile app — responsive web only

## Success Criteria

- Operator can issue an invoice and confirm the customer received the PDF email within the same session
- Audit log captures every invoice mutation with operator identity + timestamp
- All operator-only routes return 401 without a valid session cookie

## Risks

- Email deliverability: SMTP provider rate limits + spam scoring need monitoring before launch
- Tax computation correctness: jurisdiction-specific rules deferred to operator-supplied rate, must be auditable
`,
};

/**
 * Execution phase doc — `01-foundation.md`, `02-auth.md`, etc. The
 * brief that drives a single execution slice. Goal explains what +
 * why, scope lists what we touch, success criteria are testable,
 * verification spells out how we'll know it works, and out-of-scope
 * keeps the slice from creeping.
 */
export const EXECUTION_CONTRACT: PhaseContract = {
  name: 'execution-phase-doc',
  description:
    'An execution phase brief drives a single slice. The Developer reads this and must be able to act without follow-up questions. Specialist agents (ui-dev, security) consume the same brief — keep it self-contained.',
  appliesTo: (filename) => /^[0-9]{2}[\W-]/i.test(filename) && !/^00[\W-]/i.test(filename),
  sections: [
    { id: 'goal', title: 'Goal', required: true, minWords: 20 },
    { id: 'scope', title: 'Scope', required: true, minBullets: 3 },
    { id: 'success-criteria', title: 'Success Criteria', required: true, minBullets: 3 },
    { id: 'verification', title: 'Verification', required: true, minWords: 15 },
    { id: 'out-of-scope', title: 'Out of Scope', required: true, minBullets: 1 },
  ],
  defaultRetryLimit: 3,
  exemplar: `# Phase 01 — Foundation

## Goal

Stand up the Fastify HTTP service skeleton so subsequent feature phases have a stable base: server boots, config loads from .env, /health responds, structured logging is wired in, and the test harness runs.

## Scope

- Initialize package.json (ESM, Node 22 engine pin) and install Fastify + pino + dotenv-flow
- src/config.js — parse env (DATABASE_URL, SESSION_SECRET, PORT), validate, fail-fast on missing keys
- src/server.js — Fastify instance, register pino logger, register /health route, listen on PORT
- src/routes/health.js — returns { status: 'ok', uptime: process.uptime() }
- tests/ — vitest setup + one smoke test for /health
- .env.example — every key src/config.js reads, with placeholder values

## Success Criteria

- pnpm install runs clean on a fresh checkout (no peer warnings beyond known noise)
- pnpm test passes the /health smoke test
- pnpm dev boots, /health returns 200 with uptime > 0
- Missing DATABASE_URL causes server to exit with a clear "Missing env: DATABASE_URL" message
- Logs are structured JSON in prod mode, pretty-printed in dev mode

## Verification

After the developer reports done, sup smoke-tests by running pnpm dev in a terminal, hitting /health with curl, and inspecting log output for both dev and prod modes (NODE_ENV toggles formatter). Security review is not required for this phase — no auth, no user data, no external network.

## Out of Scope

- Database connection / migrations (deferred to Phase 02 — Auth)
- Auth middleware (Phase 02)
- Any business routes beyond /health
- Docker / deploy config (Phase 09 — Production)
`,
};

const CONTRACTS: readonly PhaseContract[] = [OVERVIEW_CONTRACT, EXECUTION_CONTRACT];

/**
 * Pick the first contract whose `appliesTo` predicate matches. Returns
 * `null` if no contract applies — in that case the doc bypasses
 * validation entirely (e.g. ad-hoc filenames the user adds manually).
 */
export function pickContractForFilename(filename: string): PhaseContract | null {
  for (const c of CONTRACTS) {
    if (c.appliesTo(filename)) return c;
  }
  return null;
}

/* ───── Telemetry event shape ───── */

export interface PhaseContractAttemptEvent {
  filename: string;
  contractName: string;
  /** 1-based attempt counter — increments on each invalid attempt for the same filename. */
  attemptNumber: number;
  valid: boolean;
  /** Sup invoked with override:true — validation ran in measure-only mode. */
  override: boolean;
  sectionsFound: string[];
  sectionsMissing: string[];
  violationCount: number;
  ts: number;
}
