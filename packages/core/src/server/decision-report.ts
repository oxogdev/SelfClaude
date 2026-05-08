import type { ChatLogEntry } from '../project/chat-log.js';

/**
 * Phase 6 (Replay & audit) sprint 2 — markdown report formatter.
 *
 * Walks a session's chat-log, filters to the decision-class entries
 * that the right-sidebar's Decision Trail panel surfaces, and emits a
 * shareable single-file markdown summary. Used by the
 * `/api/sessions/:id/decision-report` endpoint.
 *
 * The output is intentionally human-first — readable when pasted into
 * a PR review, a Slack thread, or an incident retro. We deliberately
 * skip machine-friendly metadata (no front-matter, no embedded JSON);
 * the source-of-truth for tooling is the raw chat-log JSONL.
 *
 * Per ROADMAP Phase 6 calibration: this is trust-signalling, not a
 * gold-plated reporting pipeline. The format is fixed for v1; if
 * downstream tooling needs structured exports, that's a separate
 * v2 endpoint, not a complication added here.
 */

export interface DecisionReportMeta {
  /** Project label (basename(cwd) or operator-set). */
  label: string;
  /** Absolute working directory the session ran in. */
  cwd: string;
  /** Session id for this report — surfaced in the title for traceability. */
  sessionId: string;
  /** ms since epoch when this report was generated. */
  generatedAt: number;
  /** Earliest ts seen in the chat-log; null when log is empty. */
  firstEntryAt: number | null;
  /** Latest ts seen in the chat-log; null when log is empty. */
  lastEntryAt: number | null;
}

interface CountSummary {
  verdicts: number;
  phase: number;
  approvals: number;
  delegations: number;
}

function classify(e: ChatLogEntry): keyof CountSummary | null {
  switch (e.type) {
    case 'verdict':
      return 'verdicts';
    case 'phase-doc-written':
    case 'phase-registered':
    case 'phase-item-confirmed':
    case 'phase-item-rejected':
    case 'phase-item-operator-verified':
      return 'phase';
    case 'approval':
    case 'approval-resolved':
      return 'approvals';
    case 'task-marker':
      return 'delegations';
    default:
      return null;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const date = d.toISOString().slice(0, 10);
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  return `${date} ${time}`;
}

/**
 * Indent each line of `text` by `prefix`. Used to slot multi-line
 * reasons / notes underneath the decision header without losing the
 * blockquote rendering.
 */
function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l.length === 0 ? '>' : `> ${l}`))
    .join('\n');
}

/**
 * Render a single decision entry as a markdown subsection. Each kind
 * picks its own icon and structure so the output reads naturally —
 * skim-able if the reader only cares about high-level events,
 * detailed if they want the full reason / evidence.
 */
function renderEntry(e: ChatLogEntry): string {
  const ts = formatTime(e.ts);
  if (e.type === 'verdict') {
    return [
      `### ⚖️  ${ts} — Verdict #${e.id.toString().padStart(3, '0')}`,
      '',
      quote(e.text),
    ].join('\n');
  }
  if (e.type === 'phase-doc-written') {
    return `### 📝 ${ts} — Phase doc written\n\n\`${e.filename}\``;
  }
  if (e.type === 'phase-registered') {
    const tag = e.isReregistration ? 're-registered' : 'registered';
    return `### 📋 ${ts} — Phase ${tag}: \`${e.slug}\`\n\n${e.title} — ${e.itemCount} item${
      e.itemCount === 1 ? '' : 's'
    }`;
  }
  if (e.type === 'phase-item-confirmed') {
    const ev = e.evidence;
    const evidenceLine =
      ev && ev.totalCount > 0
        ? `${ev.totalCount} verification call${ev.totalCount === 1 ? '' : 's'}`
        : 'no automated verification';
    const lines = [
      `### ✅ ${ts} — Confirmed: \`${e.slug}/${e.itemId}\``,
      '',
      `${e.itemTitle} _(${evidenceLine})_`,
    ];
    if (e.notes) {
      lines.push('', quote(e.notes));
    }
    return lines.join('\n');
  }
  if (e.type === 'phase-item-rejected') {
    return [
      `### ❌ ${ts} — Rejected: \`${e.slug}/${e.itemId}\``,
      '',
      e.itemTitle,
      '',
      quote(e.reason),
    ].join('\n');
  }
  if (e.type === 'phase-item-operator-verified') {
    const lines = [
      `### 👤 ${ts} — Operator-verified: \`${e.slug}/${e.itemId}\``,
      '',
      e.itemTitle,
    ];
    if (e.notes) {
      lines.push('', quote(e.notes));
    }
    return lines.join('\n');
  }
  if (e.type === 'approval') {
    return [
      `### 🛡 ${ts} — Approval requested`,
      '',
      `**Action:** ${e.action}`,
      '',
      quote(e.reason),
    ].join('\n');
  }
  if (e.type === 'approval-resolved') {
    const verb = e.decision === 'allow' ? 'Approved' : 'Denied';
    return `### 🛡 ${ts} — ${verb} (request \`${e.id.slice(0, 8)}\`)`;
  }
  if (e.type === 'task-marker') {
    return `### 🚀 ${ts} — Delegated\n\n${e.summary}`;
  }
  return '';
}

/**
 * Build the full markdown report. Entries are emitted oldest-first
 * (chronological) so the document reads like a journal — earliest
 * decisions land at the top, most recent at the bottom.
 */
export function formatDecisionReport(
  chatLog: ChatLogEntry[],
  meta: DecisionReportMeta,
): string {
  const counts: CountSummary = {
    verdicts: 0,
    phase: 0,
    approvals: 0,
    delegations: 0,
  };
  const trail: ChatLogEntry[] = [];
  for (const e of chatLog) {
    const k = classify(e);
    if (k) {
      counts[k] += 1;
      trail.push(e);
    }
  }

  const lines: string[] = [];
  lines.push(`# Decision report — ${meta.label}`);
  lines.push('');
  lines.push(`> Generated: ${formatTime(meta.generatedAt)}`);
  lines.push(`> Workspace: \`${meta.cwd}\``);
  lines.push(`> Session: \`${meta.sessionId}\``);
  if (meta.firstEntryAt !== null && meta.lastEntryAt !== null) {
    lines.push(
      `> Activity span: ${formatTime(meta.firstEntryAt)} → ${formatTime(meta.lastEntryAt)}`,
    );
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **${counts.verdicts}** verdict${counts.verdicts === 1 ? '' : 's'}`);
  lines.push(`- **${counts.phase}** phase decision${counts.phase === 1 ? '' : 's'}`);
  lines.push(`- **${counts.approvals}** approval event${counts.approvals === 1 ? '' : 's'}`);
  lines.push(`- **${counts.delegations}** delegation${counts.delegations === 1 ? '' : 's'}`);
  lines.push('');

  if (trail.length === 0) {
    lines.push('## Trail');
    lines.push('');
    lines.push('_No decisions recorded for this session._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Trail');
  lines.push('');
  for (const e of trail) {
    const rendered = renderEntry(e);
    if (rendered) {
      lines.push(rendered);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * Slug-safe filename derived from the meta. Used as the
 * `Content-Disposition` filename when the endpoint serves the
 * report. Format: `decision-report-<label>-<YYYY-MM-DD>.md`.
 */
export function decisionReportFilename(meta: DecisionReportMeta): string {
  const date = new Date(meta.generatedAt).toISOString().slice(0, 10);
  const labelSlug = meta.label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'session';
  return `decision-report-${labelSlug}-${date}.md`;
}
