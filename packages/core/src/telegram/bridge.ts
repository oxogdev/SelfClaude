import type { IncomingMessage, TelegramAdapter } from './adapter.js';
import { formatApproval, formatQuestion } from './formatter.js';
import { parseApprovalReply } from './parser.js';
import type {
  Orchestrator,
  PendingApprovalView,
  PendingQuestionView,
} from '../orchestrator/index.js';
import { log } from '../lib/log.js';

export interface TelegramBridgeOptions {
  orchestrator: Orchestrator;
  adapter: TelegramAdapter;
  /** Milliseconds to wait for an on-screen reply before escalating to Telegram. Default 15_000. */
  escalationDelayMs?: number;
}

type PendingKind = 'question' | 'approval';
interface PendingMapping {
  kind: PendingKind;
  id: string;
}

/**
 * Bridges orchestrator user-prompts to Telegram and back.
 *
 * Lifecycle:
 *   - On `user-question` / `approval-requested`, start a timer.
 *   - If `*-resolved` fires before the timer (i.e. the user answered on-screen),
 *     cancel and do nothing — Telegram never gets the prompt.
 *   - If the timer expires, send the prompt to Telegram and remember the
 *     mapping (sent message_id → pending id) so the reply can be routed.
 *   - Incoming Telegram replies that quote a tracked message resolve the
 *     corresponding pending entry.
 */
export class TelegramBridge {
  private readonly orch: Orchestrator;
  private readonly adapter: TelegramAdapter;
  private readonly escalationDelayMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly messageToPending = new Map<number, PendingMapping>();
  private started = false;

  // Pre-bound listeners so we can detach on stop without losing identity.
  private readonly onQuestionBound = (q: PendingQuestionView) => this.onQuestion(q);
  private readonly onApprovalBound = (a: PendingApprovalView) => this.onApproval(a);
  private readonly onQuestionResolvedBound = ({ id }: { id: string }) => this.cancelTimer(id);
  private readonly onApprovalResolvedBound = ({ id }: { id: string }) => this.cancelTimer(id);

  constructor(opts: TelegramBridgeOptions) {
    this.orch = opts.orchestrator;
    this.adapter = opts.adapter;
    this.escalationDelayMs = opts.escalationDelayMs ?? 15_000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.orch.on('user-question', this.onQuestionBound);
    this.orch.on('approval-requested', this.onApprovalBound);
    this.orch.on('user-question-resolved', this.onQuestionResolvedBound);
    this.orch.on('approval-resolved', this.onApprovalResolvedBound);
    await this.adapter.start((msg) => this.handleIncoming(msg));
    this.started = true;
    log('info', 'telegram.bridge_started', { delayMs: this.escalationDelayMs });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.orch.off('user-question', this.onQuestionBound);
    this.orch.off('approval-requested', this.onApprovalBound);
    this.orch.off('user-question-resolved', this.onQuestionResolvedBound);
    this.orch.off('approval-resolved', this.onApprovalResolvedBound);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.adapter.stop();
    this.started = false;
    log('info', 'telegram.bridge_stopped');
  }

  // --- internal ---

  private onQuestion(q: PendingQuestionView): void {
    if (this.timers.has(q.id)) return;
    const t = setTimeout(() => {
      this.timers.delete(q.id);
      void this.escalateQuestion(q);
    }, this.escalationDelayMs);
    this.timers.set(q.id, t);
  }

  private onApproval(a: PendingApprovalView): void {
    if (this.timers.has(a.id)) return;
    const t = setTimeout(() => {
      this.timers.delete(a.id);
      void this.escalateApproval(a);
    }, this.escalationDelayMs);
    this.timers.set(a.id, t);
  }

  private async escalateQuestion(q: PendingQuestionView): Promise<void> {
    try {
      const messageId = await this.adapter.send(formatQuestion(q));
      this.messageToPending.set(messageId, { kind: 'question', id: q.id });
      log('info', 'telegram.escalated_question', { id: q.id, messageId });
    } catch (e) {
      log('warn', 'telegram.send_failed', { reason: String(e), id: q.id, kind: 'question' });
    }
  }

  private async escalateApproval(a: PendingApprovalView): Promise<void> {
    try {
      const messageId = await this.adapter.send(formatApproval(a));
      this.messageToPending.set(messageId, { kind: 'approval', id: a.id });
      log('info', 'telegram.escalated_approval', { id: a.id, messageId });
    } catch (e) {
      log('warn', 'telegram.send_failed', { reason: String(e), id: a.id, kind: 'approval' });
    }
  }

  private async handleIncoming(msg: IncomingMessage): Promise<void> {
    let mapping: PendingMapping | undefined;
    if (msg.replyToMessageId !== undefined) {
      mapping = this.messageToPending.get(msg.replyToMessageId);
    }
    if (!mapping) {
      // Fallback: resolve the most recent escalation. Useful for users who
      // just send a plain message without using Telegram's reply feature.
      const entries = Array.from(this.messageToPending.entries());
      if (entries.length === 0) return;
      const [lastKey, lastVal] = entries[entries.length - 1]!;
      mapping = lastVal;
      this.messageToPending.delete(lastKey);
    } else {
      this.messageToPending.delete(msg.replyToMessageId!);
    }

    const text = msg.text.trim();
    if (mapping.kind === 'question') {
      const ok = this.orch.resolveUserQuestion(mapping.id, text);
      log('info', 'telegram.resolved_question', { id: mapping.id, ok });
    } else {
      const decision = parseApprovalReply(text);
      const ok = this.orch.resolveApproval(mapping.id, decision);
      log('info', 'telegram.resolved_approval', { id: mapping.id, decision, ok });
    }
  }

  private cancelTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }
}
