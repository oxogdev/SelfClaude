import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Orchestrator, type PendingApprovalView, type PendingQuestionView } from '../orchestrator/index.js';
import { runConversationTurn } from '../orchestrator/conversation.js';
import {
  extractAssistantText,
  extractToolResults,
  extractToolUses,
  type StreamEvent,
} from '../orchestrator/stream-parser.js';
import { extractDeveloperTasks } from '../orchestrator/tag-parser.js';
import {
  appendChatLogEntry,
  readChatLog,
  type ChatLogEntry,
} from '../project/chat-log.js';
import type { FsmState } from '../orchestrator/state-machine.js';
import { log } from '../lib/log.js';

export interface SessionMeta {
  id: string;
  cwd: string;
  label: string;
  createdAt: number;
  phase: string;
  supActive: boolean;
  devActive: boolean;
  busy: boolean;
}

export type SessionEvent =
  | { kind: 'state-changed'; state: FsmState }
  | { kind: 'user-message'; text: string; ts: number }
  | { kind: 'sup-message'; text: string; ts: number }
  | { kind: 'dev-text'; text: string; ts: number }
  | {
      kind: 'dev-tool-call';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | { kind: 'dev-tool-result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | { kind: 'task-marker'; summary: string; ts: number }
  | { kind: 'phase-doc-written'; filename: string; ts: number }
  | { kind: 'question'; question: PendingQuestionView }
  | { kind: 'question-resolved'; id: string; answer: string }
  | { kind: 'approval'; approval: PendingApprovalView }
  | { kind: 'approval-resolved'; id: string; decision: 'allow' | 'deny' }
  | { kind: 'iteration-end'; iteration: number }
  | { kind: 'error'; message: string }
  | { kind: 'turn-busy'; busy: boolean }
  | { kind: 'user-note-dev'; text: string; ts: number };

export interface SessionContext {
  id: string;
  cwd: string;
  label: string;
  createdAt: number;
  orchestrator: Orchestrator;
  emitter: EventEmitter;
  supervisorSessionId: string | null;
  developerSessionId: string | null;
  busy: Promise<void> | null;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  chatLog: ChatLogEntry[];
  pendingQuestions: PendingQuestionView[];
  pendingApprovals: PendingApprovalView[];
}

/**
 * Multi-session orchestrator registry. Each entry owns its own Orchestrator
 * (with its own hook server, MCP config, message bus); inter-session
 * isolation is provided naturally by per-instance state.
 *
 * Sessions emit a unified `SessionEvent` stream over their `emitter` —
 * consumed by the SSE bridge to stream changes to a connected web client.
 */
export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionContext>();

  async createSession(opts: { cwd: string; label?: string }): Promise<SessionMeta> {
    const id = randomUUID();
    const orch = new Orchestrator({ cwd: opts.cwd });
    const startResult = await orch.start();

    const ctx: SessionContext = {
      id,
      cwd: opts.cwd,
      label: opts.label ?? (basename(opts.cwd) || opts.cwd),
      createdAt: Date.now(),
      orchestrator: orch,
      emitter: new EventEmitter(),
      supervisorSessionId: startResult.projectState.supervisorSessionId,
      developerSessionId: startResult.projectState.developerSessionId,
      busy: null,
    };
    this.sessions.set(id, ctx);
    this.attachOrchestratorEvents(ctx);

    log('info', 'session.created', { id, cwd: opts.cwd });
    this.emit('session-created', this.toMeta(ctx));
    return this.toMeta(ctx);
  }

  async destroySession(id: string): Promise<void> {
    const ctx = this.sessions.get(id);
    if (!ctx) return;
    if (ctx.busy) {
      // Best-effort: wait briefly for the in-flight turn to settle.
      await Promise.race([ctx.busy, new Promise((r) => setTimeout(r, 5_000))]);
    }
    await ctx.orchestrator.stop();
    this.sessions.delete(id);
    log('info', 'session.destroyed', { id });
    this.emit('session-destroyed', id);
  }

  getSession(id: string): SessionContext | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionMeta[] {
    return Array.from(this.sessions.values()).map((c) => this.toMeta(c));
  }

  async sendMessage(id: string, text: string): Promise<void> {
    const ctx = this.sessions.get(id);
    if (!ctx) throw new Error(`session not found: ${id}`);
    if (ctx.busy) throw new Error('session is busy with another turn');

    const ts = Date.now();
    await this.appendLog(ctx, { type: 'user-message', text, ts });
    this.emitEvent(ctx, { kind: 'user-message', text, ts });
    this.emitEvent(ctx, { kind: 'turn-busy', busy: true });

    const run = (async () => {
      try {
        const result = await runConversationTurn({
          orchestrator: ctx.orchestrator,
          userPrompt: text,
          supervisorSessionId: ctx.supervisorSessionId ?? undefined,
          developerSessionId: ctx.developerSessionId ?? undefined,
          onSupervisorEvent: (e) => this.onSupervisorStreamEvent(ctx, e),
          onDeveloperEvent: (e) => this.onDeveloperStreamEvent(ctx, e),
        });
        ctx.supervisorSessionId = result.supervisorSessionId ?? ctx.supervisorSessionId;
        ctx.developerSessionId = result.developerSessionId ?? ctx.developerSessionId;
      } catch (e) {
        this.emitEvent(ctx, { kind: 'error', message: (e as Error).message });
      } finally {
        ctx.busy = null;
        this.emitEvent(ctx, { kind: 'turn-busy', busy: false });
      }
    })();
    ctx.busy = run;
  }

  /**
   * Drop a user-authored note into the developer's inbox without triggering
   * a turn. The next time the developer agent runs, the note arrives via the
   * UserPromptSubmit hook injection, alongside any supervisor-routed task.
   * This lets the user steer the developer directly (e.g. "be careful with
   * that file", "use port 4000 instead") without interrupting the
   * supervisor's planning.
   */
  async noteForDeveloper(id: string, text: string): Promise<void> {
    const ctx = this.sessions.get(id);
    if (!ctx) throw new Error(`session not found: ${id}`);
    const ts = Date.now();
    ctx.orchestrator.messages.enqueue({
      to: 'developer',
      source: 'user',
      body: `USER_NOTE_FOR_DEVELOPER:\n${text}`,
    });
    await this.appendLog(ctx, { type: 'user-note-dev', text, ts });
    this.emitEvent(ctx, { kind: 'user-note-dev', text, ts });
  }

  async resolveQuestion(id: string, questionId: string, answer: string): Promise<boolean> {
    const ctx = this.sessions.get(id);
    if (!ctx) return false;
    const ok = ctx.orchestrator.resolveUserQuestion(questionId, answer);
    if (ok) {
      const ts = Date.now();
      await this.appendLog(ctx, { type: 'question-resolved', id: questionId, answer, ts });
    }
    return ok;
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    decision: 'allow' | 'deny',
  ): Promise<boolean> {
    const ctx = this.sessions.get(id);
    if (!ctx) return false;
    const ok = ctx.orchestrator.resolveApproval(approvalId, decision);
    if (ok) {
      const ts = Date.now();
      await this.appendLog(ctx, { type: 'approval-resolved', id: approvalId, decision, ts });
    }
    return ok;
  }

  async getSnapshot(id: string): Promise<SessionSnapshot | null> {
    const ctx = this.sessions.get(id);
    if (!ctx) return null;
    const chatLog = await readChatLog(ctx.cwd);
    return {
      meta: this.toMeta(ctx),
      chatLog,
      pendingQuestions: ctx.orchestrator.listPendingQuestions(),
      pendingApprovals: ctx.orchestrator.listPendingApprovals(),
    };
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.destroySession(id)));
  }

  // --- internal ---

  private toMeta(ctx: SessionContext): SessionMeta {
    const fsmState = ctx.orchestrator.getState();
    return {
      id: ctx.id,
      cwd: ctx.cwd,
      label: ctx.label,
      createdAt: ctx.createdAt,
      phase: fsmState.tag === 'shutdown' ? 'shutdown' : fsmState.phase,
      supActive: fsmState.tag === 'sup-running',
      devActive: fsmState.tag === 'dev-running',
      busy: ctx.busy !== null,
    };
  }

  private async appendLog(ctx: SessionContext, entry: ChatLogEntry): Promise<void> {
    try {
      await appendChatLogEntry(ctx.cwd, entry);
    } catch (e) {
      log('warn', 'session.chat_log_append_failed', {
        id: ctx.id,
        error: (e as Error).message,
      });
    }
  }

  private emitEvent(ctx: SessionContext, event: SessionEvent): void {
    ctx.emitter.emit('event', event);
  }

  private attachOrchestratorEvents(ctx: SessionContext): void {
    const orch = ctx.orchestrator;
    orch.on('state-changed', (state: FsmState) => {
      this.emitEvent(ctx, { kind: 'state-changed', state });
    });
    orch.on('user-question', (q: PendingQuestionView) => {
      const ts = Date.now();
      void this.appendLog(ctx, {
        type: 'question',
        id: q.id,
        text: q.question,
        options: q.options,
        ts,
      });
      this.emitEvent(ctx, { kind: 'question', question: q });
    });
    orch.on('user-question-resolved', ({ id, answer }: { id: string; answer: string }) => {
      this.emitEvent(ctx, { kind: 'question-resolved', id, answer });
    });
    orch.on('approval-requested', (a: PendingApprovalView) => {
      const ts = Date.now();
      void this.appendLog(ctx, {
        type: 'approval',
        id: a.id,
        action: a.action,
        reason: a.reason,
        ts,
      });
      this.emitEvent(ctx, { kind: 'approval', approval: a });
    });
    orch.on(
      'approval-resolved',
      ({ id, decision }: { id: string; decision: 'allow' | 'deny' }) => {
        this.emitEvent(ctx, { kind: 'approval-resolved', id, decision });
      },
    );
    orch.on('phase-doc-written', (e: { filename: string }) => {
      const ts = Date.now();
      void this.appendLog(ctx, { type: 'phase-doc-written', filename: e.filename, ts });
      this.emitEvent(ctx, { kind: 'phase-doc-written', filename: e.filename, ts });
    });
    orch.on('conversation-completed', (info: { iterations: number }) => {
      this.emitEvent(ctx, { kind: 'iteration-end', iteration: info.iterations });
    });
  }

  private onSupervisorStreamEvent(ctx: SessionContext, e: StreamEvent): void {
    if (e.type !== 'assistant') return;
    const text = extractAssistantText(e);
    if (!text) return;
    const ts = Date.now();
    void this.appendLog(ctx, { type: 'sup-message', text, ts });
    this.emitEvent(ctx, { kind: 'sup-message', text, ts });
    const { tasks } = extractDeveloperTasks(text);
    for (const task of tasks) {
      const summary = (task.split('\n')[0] ?? '').slice(0, 120);
      if (!summary) continue;
      void this.appendLog(ctx, { type: 'task-marker', summary, ts });
      this.emitEvent(ctx, { kind: 'task-marker', summary, ts });
    }
  }

  private onDeveloperStreamEvent(ctx: SessionContext, e: StreamEvent): void {
    const ts = Date.now();
    for (const tu of extractToolUses(e)) {
      const id = randomUUID();
      void this.appendLog(ctx, {
        type: 'dev-tool-call',
        id,
        toolUseId: tu.id,
        name: tu.name,
        input: tu.input,
        ts,
      });
      this.emitEvent(ctx, {
        kind: 'dev-tool-call',
        id,
        toolUseId: tu.id,
        name: tu.name,
        input: tu.input,
        ts,
      });
    }
    for (const tr of extractToolResults(e)) {
      void this.appendLog(ctx, {
        type: 'dev-tool-result',
        toolUseId: tr.toolUseId,
        text: tr.text,
        isError: tr.isError,
        ts,
      });
      this.emitEvent(ctx, {
        kind: 'dev-tool-result',
        toolUseId: tr.toolUseId,
        text: tr.text,
        isError: tr.isError,
        ts,
      });
    }
    if (e.type === 'assistant') {
      const text = extractAssistantText(e);
      if (text) {
        void this.appendLog(ctx, { type: 'dev-text', text, ts });
        this.emitEvent(ctx, { kind: 'dev-text', text, ts });
      }
    }
  }
}
