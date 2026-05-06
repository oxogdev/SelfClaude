'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Rocket } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * 3-step onboarding wizard. Run between "operator picks a folder" and
 * "session opens" so the supervisor's first turn lands with structured
 * project context instead of starting cold.
 *
 * Step 1: project basics — name + type + one-line goal. The type drives
 * whether sup applies an agent DNA template (admin-panel today; future
 * templates can be added to the radio).
 *
 * Step 2: stack brief — free-form paragraph. Sup parses it on first
 * turn into the normalised `.selfclaude/stack.json` (canonical naming:
 * "Next.js" not "nextjs"). Operator review/tweak afterwards via the
 * Stack panel.
 *
 * Step 3: constraints — free-form. Hard requirements, things-not-to-
 * touch, integration notes. Anything the operator wants the agents to
 * honour but isn't a stack item.
 *
 * Skip path: an "Open without wizard" link in the footer creates the
 * session with no kickoff, lets sup do its own Discovery from scratch.
 */

export type ProjectType = 'admin-panel' | 'marketing-site' | 'library' | 'mobile' | 'other';

const PROJECT_TYPE_OPTIONS: Array<{
  value: ProjectType;
  label: string;
  description: string;
}> = [
  {
    value: 'admin-panel',
    label: 'Admin panel / dashboard',
    description: 'CRUD tables, modals, sidebar+header layout. Triggers admin-panel DNA on ui-dev.',
  },
  {
    value: 'marketing-site',
    label: 'Marketing site / landing',
    description: 'Bespoke design, mostly content + animation. No DNA applied; ui-dev stays general.',
  },
  {
    value: 'library',
    label: 'Library / package',
    description: 'Reusable code with no UI; tests + types are the deliverable.',
  },
  {
    value: 'mobile',
    label: 'Mobile app',
    description: 'iOS / Android / cross-platform. No bundled DNA yet; ui-dev gets general guidance.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'CLI, daemon, ML pipeline — anything else. Sup will ask follow-ups.',
  },
];

export interface WizardSubmission {
  projectName: string;
  projectType: ProjectType;
  goal: string;
  stackBrief: string;
  constraints: string;
}

export function NewProjectWizard({
  cwd,
  onLaunch,
  onSkip,
  onCancel,
}: {
  cwd: string;
  /** Called when operator submits the wizard. Returns Promise so the modal can show pending state. */
  onLaunch: (submission: WizardSubmission) => Promise<void>;
  /** Called when operator wants to skip the wizard and start chat from scratch. */
  onSkip: () => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState(() => deriveDefaultName(cwd));
  const [type, setType] = useState<ProjectType>('admin-panel');
  const [goal, setGoal] = useState('');
  const [stackBrief, setStackBrief] = useState('');
  const [constraints, setConstraints] = useState('');
  const [submitting, setSubmitting] = useState<'launch' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && submitting === null) onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, submitting]);

  const canAdvance = (): boolean => {
    if (step === 1) return name.trim().length > 0 && goal.trim().length > 0;
    if (step === 2) return stackBrief.trim().length >= 20;
    if (step === 3) return true; // constraints optional
    return true;
  };

  const handleLaunch = async () => {
    if (submitting !== null) return;
    setSubmitting('launch');
    setError(null);
    try {
      await onLaunch({
        projectName: name.trim(),
        projectType: type,
        goal: goal.trim(),
        stackBrief: stackBrief.trim(),
        constraints: constraints.trim(),
      });
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(null);
    }
  };

  const handleSkip = async () => {
    if (submitting !== null) return;
    setSubmitting('skip');
    setError(null);
    try {
      await onSkip();
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && submitting === null) onCancel();
      }}
    >
      <div className="bg-bg border border-border-strong rounded-lg w-[min(720px,100%)] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <header className="px-6 py-4 border-b border-border-strong flex items-center gap-3">
          <Rocket size={16} className="text-cyan-400 shrink-0" />
          <div className="flex-1">
            <h2 className="text-[14px] font-mono font-semibold text-zinc-100">
              New project setup
            </h2>
            <p className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate" title={cwd}>
              {cwd}
            </p>
          </div>
          <StepIndicator current={step} total={4} />
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          {step === 1 && (
            <Step1Basics
              name={name}
              setName={setName}
              type={type}
              setType={setType}
              goal={goal}
              setGoal={setGoal}
            />
          )}
          {step === 2 && (
            <Step2Stack stackBrief={stackBrief} setStackBrief={setStackBrief} />
          )}
          {step === 3 && (
            <Step3Constraints constraints={constraints} setConstraints={setConstraints} />
          )}
          {step === 4 && (
            <Step4Review
              name={name}
              type={type}
              goal={goal}
              stackBrief={stackBrief}
              constraints={constraints}
            />
          )}
        </div>

        {error && (
          <div className="px-6 py-2 border-t border-red-700/50 bg-red-950/30">
            <p className="text-[11px] font-mono text-red-300">{error}</p>
          </div>
        )}

        <footer className="px-6 py-3 border-t border-border-strong flex items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              disabled={submitting !== null}
              className="text-[12px] font-mono px-3 py-1.5 rounded border border-border bg-bg-elevated/40 text-zinc-300 hover:bg-bg-elevated/70 inline-flex items-center gap-1.5"
            >
              <ArrowLeft size={12} /> back
            </button>
          )}
          {step === 1 && (
            <button
              type="button"
              onClick={handleSkip}
              disabled={submitting !== null}
              className="text-[11px] font-mono text-zinc-500 hover:text-zinc-200 underline"
            >
              {submitting === 'skip' ? 'opening…' : 'skip wizard, talk to sup directly'}
            </button>
          )}
          <span className="flex-1" />
          {step < 4 && (
            <button
              type="button"
              onClick={() => canAdvance() && setStep((s) => Math.min(4, s + 1) as 1 | 2 | 3 | 4)}
              disabled={!canAdvance() || submitting !== null}
              className={cn(
                'text-[12px] font-mono px-4 py-1.5 rounded inline-flex items-center gap-1.5 border',
                canAdvance() && submitting === null
                  ? 'border-cyan-700 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-900/60'
                  : 'border-zinc-700 bg-zinc-900/40 text-zinc-600 cursor-not-allowed',
              )}
            >
              next <ArrowRight size={12} />
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              onClick={handleLaunch}
              disabled={submitting !== null}
              className={cn(
                'text-[12px] font-mono font-medium px-4 py-1.5 rounded inline-flex items-center gap-1.5 border',
                submitting !== null
                  ? 'border-zinc-700 bg-zinc-900/40 text-zinc-500 cursor-not-allowed'
                  : 'border-cyan-600 bg-cyan-700 text-white hover:bg-cyan-600',
              )}
            >
              {submitting === 'launch' ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> launching…
                </>
              ) : (
                <>
                  <Rocket size={12} /> launch with brief
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={cn(
            'w-2 h-2 rounded-full',
            n < current
              ? 'bg-cyan-500'
              : n === current
                ? 'bg-cyan-400 ring-2 ring-cyan-500/30'
                : 'bg-zinc-700',
          )}
        />
      ))}
    </div>
  );
}

function Step1Basics({
  name,
  setName,
  type,
  setType,
  goal,
  setGoal,
}: {
  name: string;
  setName: (v: string) => void;
  type: ProjectType;
  setType: (v: ProjectType) => void;
  goal: string;
  setGoal: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[12px] font-mono font-semibold text-zinc-100 mb-1">
          Step 1 — Project basics
        </h3>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          What are we building? Type drives whether the supervisor applies a
          DNA template to the right specialist.
        </p>
      </div>
      <Field label="Project name" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kick CRM"
          className="w-full bg-bg-subtle border border-border rounded-md px-3 py-2 text-[12px] font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600"
        />
      </Field>
      <Field label="Project type" required>
        <div className="grid gap-1.5">
          {PROJECT_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex items-start gap-2.5 px-3 py-2 rounded-md border cursor-pointer',
                type === opt.value
                  ? 'border-cyan-700 bg-cyan-950/30'
                  : 'border-border bg-bg-elevated/30 hover:bg-bg-elevated/60',
              )}
            >
              <input
                type="radio"
                name="project-type"
                value={opt.value}
                checked={type === opt.value}
                onChange={() => setType(opt.value)}
                className="mt-0.5 accent-cyan-600"
              />
              <div className="min-w-0">
                <div className="text-[12px] font-mono font-medium text-zinc-100">
                  {opt.label}
                </div>
                <div className="text-[10px] text-zinc-500 leading-relaxed">
                  {opt.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Goal (one line)" required>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Internal CRM for sales team to track leads + deals"
          className="w-full bg-bg-subtle border border-border rounded-md px-3 py-2 text-[12px] font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600"
        />
      </Field>
    </div>
  );
}

function Step2Stack({
  stackBrief,
  setStackBrief,
}: {
  stackBrief: string;
  setStackBrief: (v: string) => void;
}) {
  const example =
    'Backend Fastify API with Swagger, frontend Next.js with App Router, ' +
    'shadcn + Tailwind v4, Postgres with Drizzle, zod required, ' +
    'docker stack, migrations self-managed.';
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[12px] font-mono font-semibold text-zinc-100 mb-1">
          Step 2 — Tech stack brief
        </h3>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Free-form paragraph. The supervisor parses this into a normalized{' '}
          <code className="text-zinc-400">.selfclaude/stack.json</code> (e.g.{' '}
          "next.js" / "nextjs" / "Next js" all become <strong>Next.js</strong>),
          locks the items you committed to, and reads it before delegating
          tasks. You can edit/lock individual items afterwards via the Stack
          panel.
        </p>
      </div>
      <Field
        label="Stack description"
        required
        hint={`Min 20 chars. Mention language, framework(s), database, key libraries — natural prose is fine.`}
      >
        <textarea
          value={stackBrief}
          onChange={(e) => setStackBrief(e.target.value)}
          placeholder={example}
          rows={8}
          className="w-full bg-bg-subtle border border-border rounded-md px-3 py-2 text-[12px] font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600 resize-none leading-relaxed"
        />
      </Field>
      <button
        type="button"
        onClick={() => setStackBrief(example)}
        className="text-[10px] font-mono text-zinc-500 hover:text-zinc-200 underline"
      >
        use example as template
      </button>
    </div>
  );
}

function Step3Constraints({
  constraints,
  setConstraints,
}: {
  constraints: string;
  setConstraints: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[12px] font-mono font-semibold text-zinc-100 mb-1">
          Step 3 — Constraints (optional)
        </h3>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Hard requirements, things-not-to-touch, integrations the agents
          should honour. Anything that isn't a stack item but matters. Skip
          this step if you don't have anything to add — sup will ask
          follow-ups during Discovery.
        </p>
      </div>
      <Field
        label="Constraints / non-goals / integrations"
        hint="One per line works well. Or free prose. Empty is fine."
      >
        <textarea
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder={'- Must run on Bun runtime\n- Don\'t modify legacy /etl pipeline\n- Auth via Clerk (already integrated)\n- Deployment: Docker on a single VPS for now'}
          rows={7}
          className="w-full bg-bg-subtle border border-border rounded-md px-3 py-2 text-[12px] font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600 resize-none leading-relaxed"
        />
      </Field>
    </div>
  );
}

function Step4Review({
  name,
  type,
  goal,
  stackBrief,
  constraints,
}: {
  name: string;
  type: ProjectType;
  goal: string;
  stackBrief: string;
  constraints: string;
}) {
  const typeLabel =
    PROJECT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[12px] font-mono font-semibold text-zinc-100 mb-1">
          Step 4 — Review
        </h3>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Confirm and launch. The supervisor will use this as authoritative
          input — parse the stack brief into a normalized manifest, apply
          DNA if applicable, write CLAUDE.md, then ask follow-up questions
          for anything missing.
        </p>
      </div>
      <ReviewBlock label="Project">
        <p className="text-[12px] font-mono text-zinc-200">
          <strong>{name}</strong>
          <span className="text-zinc-500"> · {typeLabel}</span>
        </p>
        <p className="text-[11px] font-mono text-zinc-400 mt-1">{goal}</p>
      </ReviewBlock>
      <ReviewBlock label="Stack brief">
        <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
          {stackBrief}
        </pre>
      </ReviewBlock>
      <ReviewBlock label="Constraints">
        {constraints.trim().length > 0 ? (
          <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
            {constraints}
          </pre>
        ) : (
          <p className="text-[11px] font-mono italic text-zinc-500">(none)</p>
        )}
      </ReviewBlock>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-widest font-mono font-semibold text-zinc-400 mb-1.5">
        {label}
        {required && <span className="text-cyan-400"> *</span>}
      </div>
      {children}
      {hint && (
        <p className="text-[10px] font-mono text-zinc-600 mt-1 leading-relaxed">{hint}</p>
      )}
    </label>
  );
}

function ReviewBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-bg-elevated/30 px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-widest font-mono font-semibold text-zinc-500 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function deriveDefaultName(cwd: string): string {
  const base = cwd.split('/').filter(Boolean).pop() ?? '';
  // Light prettify: replace separators with spaces and Title Case the result.
  return base
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build the structured `BOOTSTRAP_BRIEF:` first message that sup parses
 * on its first turn. Format is intentionally section-headed so the
 * model has unambiguous field boundaries even when stack/constraints
 * include colons or bullets.
 */
export function buildBootstrapBrief(submission: WizardSubmission): string {
  const lines: string[] = ['BOOTSTRAP_BRIEF:'];
  lines.push('');
  lines.push(`PROJECT_TYPE: ${submission.projectType}`);
  lines.push(`PROJECT_NAME: ${submission.projectName}`);
  lines.push(`GOAL: ${submission.goal}`);
  lines.push('');
  lines.push('STACK_BRIEF:');
  lines.push(submission.stackBrief);
  if (submission.constraints.trim().length > 0) {
    lines.push('');
    lines.push('CONSTRAINTS:');
    lines.push(submission.constraints);
  }
  lines.push('');
  lines.push('---');
  lines.push(
    'Use this as authoritative bootstrap input: parse the stack brief into a normalized ' +
      '.selfclaude/stack.json (canonical naming + locking the committed items), apply the ' +
      'matching DNA template if PROJECT_TYPE has one, write a focused CLAUDE.md from the goal ' +
      "+ constraints, then continue Discovery for anything missing — don't re-ask what's already " +
      'answered above.',
  );
  return lines.join('\n');
}
