import { z } from 'zod';

export const AskUserArgsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  urgency: z.enum(['low', 'high']).default('low'),
});
export type AskUserArgs = z.infer<typeof AskUserArgsSchema>;

export const AskUserHttpRequestSchema = AskUserArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type AskUserHttpRequest = z.infer<typeof AskUserHttpRequestSchema>;

export const AskUserHttpResponseSchema = z.object({
  answer: z.string(),
});
export type AskUserHttpResponse = z.infer<typeof AskUserHttpResponseSchema>;

export const RequestApprovalArgsSchema = z.object({
  action: z.string().min(1),
  reason: z.string().min(1),
});
export type RequestApprovalArgs = z.infer<typeof RequestApprovalArgsSchema>;

export const RequestApprovalHttpRequestSchema = RequestApprovalArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type RequestApprovalHttpRequest = z.infer<typeof RequestApprovalHttpRequestSchema>;

export const RequestApprovalHttpResponseSchema = z.object({
  decision: z.enum(['allow', 'deny']),
});
export type RequestApprovalHttpResponse = z.infer<typeof RequestApprovalHttpResponseSchema>;

export const WritePhaseDocArgsSchema = z.object({
  filename: z
    .string()
    .regex(/^[\w][\w-]*\.md$/, 'filename must look like "00-overview.md" (slug + .md)'),
  content: z.string().min(1),
});
export type WritePhaseDocArgs = z.infer<typeof WritePhaseDocArgsSchema>;

export const WritePhaseDocHttpRequestSchema = WritePhaseDocArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
});
export type WritePhaseDocHttpRequest = z.infer<typeof WritePhaseDocHttpRequestSchema>;

export const WritePhaseDocHttpResponseSchema = z.object({
  path: z.string(),
});
export type WritePhaseDocHttpResponse = z.infer<typeof WritePhaseDocHttpResponseSchema>;

/* ───── Phase tracker MCP tools ─────
 *
 * Four tools work in pairs:
 *   - `register_phase_items` (sup) declares the DoD list for a phase
 *     when entering it. Re-registering merges with prior progress so
 *     re-running doesn't wipe what's already been confirmed.
 *   - `propose_item_done` (any agent) reports completion. Item moves
 *     to `proposed`; orchestrator notifies the supervisor's inbox so
 *     it'll review on its next turn.
 *   - `confirm_item_done` (sup) finalises the item as done after
 *     review/test. Notifies the proposer's inbox.
 *   - `reject_item_done` (sup) sends the item back to `pending` with
 *     a reason. Notifies the proposer's inbox.
 *
 * The tracker file (`<cwd>/.selfclaude/phases.json`) is the canonical
 * progress source; the prose `docs/phases/*.md` briefs stay free-form.
 */

const slugRe = /^[a-z0-9][a-z0-9-]*$/;

export const PhaseItemRegistrationSchema = z.object({
  id: z.string().min(1).max(80).regex(slugRe, 'id must be a slug (a-z0-9-)'),
  title: z.string().min(1).max(200),
});

export const RegisterPhaseItemsArgsSchema = z.object({
  /** Phase slug — matches the markdown brief's filename basename, e.g. `01-foundation`. */
  slug: z.string().min(1).max(80).regex(slugRe, 'slug must be like "01-foundation"'),
  /** Display title — the human-readable name shown in the UI. */
  title: z.string().min(1).max(200),
  items: z.array(PhaseItemRegistrationSchema).min(1),
});
export type RegisterPhaseItemsArgs = z.infer<typeof RegisterPhaseItemsArgsSchema>;

export const RegisterPhaseItemsHttpRequestSchema = RegisterPhaseItemsArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1).default('supervisor'),
});
export type RegisterPhaseItemsHttpRequest = z.infer<typeof RegisterPhaseItemsHttpRequestSchema>;

export const ProposeItemDoneArgsSchema = z.object({
  slug: z.string().min(1).max(80).regex(slugRe),
  itemId: z.string().min(1).max(80).regex(slugRe),
  /** Free-form summary: what the agent did + how to verify. */
  notes: z.string().max(2000).default(''),
});
export type ProposeItemDoneArgs = z.infer<typeof ProposeItemDoneArgsSchema>;

export const ProposeItemDoneHttpRequestSchema = ProposeItemDoneArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1),
});
export type ProposeItemDoneHttpRequest = z.infer<typeof ProposeItemDoneHttpRequestSchema>;

export const ConfirmItemDoneArgsSchema = z.object({
  slug: z.string().min(1).max(80).regex(slugRe),
  itemId: z.string().min(1).max(80).regex(slugRe),
  /** Optional sup note — usually "tested X, looks good" or similar. */
  notes: z.string().max(2000).default(''),
});
export type ConfirmItemDoneArgs = z.infer<typeof ConfirmItemDoneArgsSchema>;

export const ConfirmItemDoneHttpRequestSchema = ConfirmItemDoneArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1),
});
export type ConfirmItemDoneHttpRequest = z.infer<typeof ConfirmItemDoneHttpRequestSchema>;

export const RejectItemDoneArgsSchema = z.object({
  slug: z.string().min(1).max(80).regex(slugRe),
  itemId: z.string().min(1).max(80).regex(slugRe),
  /** Required: reason for rejection so the proposer can fix it. */
  reason: z.string().min(1).max(2000),
});
export type RejectItemDoneArgs = z.infer<typeof RejectItemDoneArgsSchema>;

export const RejectItemDoneHttpRequestSchema = RejectItemDoneArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1),
});
export type RejectItemDoneHttpRequest = z.infer<typeof RejectItemDoneHttpRequestSchema>;

export const PhaseTrackerHttpResponseSchema = z.object({
  ok: z.boolean(),
  /** Human-readable trail entry summarising what changed; surfaced to the agent. */
  message: z.string(),
});
export type PhaseTrackerHttpResponse = z.infer<typeof PhaseTrackerHttpResponseSchema>;

/* ───── Agent DNA application MCP tool ─────
 *
 * The supervisor calls this at project bootstrap to opt a specific
 * agent into a deeper standards contract — e.g. the "admin-panel" DNA
 * for ui-dev, which appends a strict topology + visual contract on top
 * of the bundled orchestration prompt. See `agents/dna.ts` for the
 * registry of bundled templates.
 *
 * Idempotent by default: if the project already has the DNA file,
 * returns ok:false with reason "already-applied" so the supervisor
 * doesn't clobber operator hand-edits.
 */

export const ApplyAgentDnaArgsSchema = z.object({
  /** Slug from the bundled DNA registry (e.g. "admin-panel"). */
  dnaSlug: z.string().min(1).max(80),
  /**
   * Force overwrite when a DNA file already exists. Defaults to false
   * so a bootstrap call is safe to re-run without losing edits.
   */
  force: z.boolean().default(false),
});
export type ApplyAgentDnaArgs = z.infer<typeof ApplyAgentDnaArgsSchema>;

export const ApplyAgentDnaHttpRequestSchema = ApplyAgentDnaArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1).default('supervisor'),
});
export type ApplyAgentDnaHttpRequest = z.infer<typeof ApplyAgentDnaHttpRequestSchema>;

export const ApplyAgentDnaHttpResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ApplyAgentDnaHttpResponse = z.infer<typeof ApplyAgentDnaHttpResponseSchema>;

/* ───── propose_script MCP tool ─────
 *
 * The supervisor uses this to propose a recurring Bash command as a
 * reusable script. Operator reviews + approves through the web UI;
 * approved scripts land in `<cwd>/.selfclaude/scripts/<slug>.sh` and
 * sup invokes them via the regular `Bash` tool. See `scripts-store.ts`
 * for the full lifecycle.
 */

export const ProposeScriptArgsSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be kebab-case (a-z, 0-9, hyphen)'),
  body: z.string().min(1).max(8 * 1024),
  reason: z.string().min(1).max(2000),
});
export type ProposeScriptArgs = z.infer<typeof ProposeScriptArgsSchema>;

export const ProposeScriptHttpRequestSchema = ProposeScriptArgsSchema.extend({
  role: z.enum(['supervisor', 'developer']),
  agent: z.string().min(1).default('supervisor'),
});
export type ProposeScriptHttpRequest = z.infer<typeof ProposeScriptHttpRequestSchema>;

export const ProposeScriptHttpResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ProposeScriptHttpResponse = z.infer<typeof ProposeScriptHttpResponseSchema>;
