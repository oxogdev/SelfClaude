import type {
  PendingApprovalView,
  PendingQuestionView,
} from '../orchestrator/index.js';

/**
 * Telegram-flavored markdown for an `ask_user` escalation. Keep it compact —
 * notification preview only shows the first line.
 */
export function formatQuestion(q: PendingQuestionView): string {
  const lines: string[] = [];
  const urgencyMark = q.urgency === 'high' ? '❗' : '❓';
  lines.push(`${urgencyMark} *Question from ${q.role}*`);
  lines.push('');
  lines.push(q.question);
  if (q.options && q.options.length > 0) {
    lines.push('');
    lines.push(q.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n'));
  }
  lines.push('');
  lines.push('_Reply to this message to answer._');
  return lines.join('\n');
}

/**
 * Telegram markdown for a destructive-op approval request. The user replies
 * with `yes`/`y`/`allow` to permit the action, or anything else to deny.
 */
export function formatApproval(a: PendingApprovalView): string {
  const lines: string[] = [];
  const tag = a.origin === 'pre-tool-use' ? '⚠️' : '🔐';
  lines.push(`${tag} *Approval requested (${a.role})*`);
  lines.push('');
  lines.push(`*Action:* ${a.action}`);
  if (a.summary && a.summary !== a.action) {
    lines.push(`*Summary:* \`${a.summary}\``);
  }
  lines.push(`*Reason:* ${a.reason}`);
  lines.push('');
  lines.push('_Reply `yes` to allow, anything else to deny._');
  return lines.join('\n');
}
