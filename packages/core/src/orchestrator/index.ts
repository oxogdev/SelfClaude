import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MessageBus } from './message-bus.js';
import { initialState, transition, type FsmEvent, type FsmState } from './state-machine.js';
import { evaluatePolicy } from './policy.js';
import { startHookServer } from '../hooks/server.js';
import { installWorkspace, type WorkspacePaths } from '../hooks/installer.js';
import type { Role } from '../hooks/types.js';
import type {
  AskUserHttpRequest,
  RequestApprovalHttpRequest,
  WritePhaseDocHttpRequest,
} from '../mcp/types.js';
import { detectProject } from '../project/detect.js';
import {
  newProjectState,
  writeProjectState,
  type ProjectState,
} from '../project/state.js';
import { log } from '../lib/log.js';

export interface OrchestratorOptions {
  cwd: string;
}

export type HookEnv = Record<string, string> & {
  SELFCLAUDE_ORCH_URL: string;
  SELFCLAUDE_ROLE: Role;
};

interface PendingQuestion {
  id: string;
  role: Role;
  question: string;
  options?: string[];
  urgency: 'low' | 'high';
  resolve: (answer: string) => void;
}

export interface PendingQuestionView {
  id: string;
  role: Role;
  question: string;
  options?: string[];
  urgency: 'low' | 'high';
}

interface PendingApproval {
  id: string;
  role: Role;
  toolName: string | null;
  toolInput: unknown;
  action: string;
  reason: string;
  summary: string;
  origin: 'pre-tool-use' | 'mcp';
  resolve: (decision: 'allow' | 'deny') => void;
}

export interface PendingApprovalView {
  id: string;
  role: Role;
  toolName: string | null;
  action: string;
  reason: string;
  summary: string;
  origin: 'pre-tool-use' | 'mcp';
}

export interface StartResult {
  /** True if a `.selfclaude/state.json` was found and loaded; false for fresh init. */
  existing: boolean;
  /** Snapshot of the project state right after start (initial or restored). */
  projectState: ProjectState;
}

/**
 * Top-level orchestrator. Holds the message bus, FSM, hook + MCP HTTP server,
 * workspace paths, the registries that back `ask_user` and `request_user_approval`,
 * and the persistent project state.
 */
export class Orchestrator extends EventEmitter {
  readonly messages = new MessageBus();
  private state: FsmState = initialState();
  private hookServer: FastifyInstance | null = null;
  private workspace: WorkspacePaths | null = null;
  private hookUrl: string | null = null;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private projectState: ProjectState | null = null;
  private statePath: string | null = null;

  constructor(readonly options: OrchestratorOptions) {
    super();
  }

  getState(): FsmState {
    return this.state;
  }

  getHookUrl(): string | null {
    return this.hookUrl;
  }

  getWorkspace(): WorkspacePaths {
    if (!this.workspace) throw new Error('orchestrator not started');
    return this.workspace;
  }

  hookEnv(role: Role): HookEnv {
    if (!this.hookUrl) throw new Error('orchestrator not started');
    return { SELFCLAUDE_ORCH_URL: this.hookUrl, SELFCLAUDE_ROLE: role };
  }

  dispatch(event: FsmEvent): FsmState {
    const previous = this.state;
    this.state = transition(this.state, event);
    log('debug', 'fsm.transition', {
      from: previous.tag,
      to: this.state.tag,
      event: event.kind,
    });
    this.emit('state-changed', this.state, previous);
    return this.state;
  }

  askUser(req: AskUserHttpRequest): Promise<{ answer: string }> {
    const id = randomUUID();
    return new Promise<{ answer: string }>((resolve) => {
      const entry: PendingQuestion = {
        id,
        role: req.role,
        question: req.question,
        options: req.options,
        urgency: req.urgency,
        resolve: (answer) => resolve({ answer }),
      };
      this.pendingQuestions.set(id, entry);
      log('info', 'mcp.ask_user', {
        id,
        role: req.role,
        urgency: req.urgency,
        question: req.question,
      });
      this.emit('user-question', {
        id,
        role: req.role,
        question: req.question,
        options: req.options,
        urgency: req.urgency,
      } satisfies PendingQuestionView);
    });
  }

  resolveUserQuestion(id: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return false;
    this.pendingQuestions.delete(id);
    log('info', 'mcp.ask_user.resolved', { id, answerLength: answer.length });
    pending.resolve(answer);
    this.emit('user-question-resolved', { id, answer });
    return true;
  }

  listPendingQuestions(): PendingQuestionView[] {
    return Array.from(this.pendingQuestions.values()).map((p) => ({
      id: p.id,
      role: p.role,
      question: p.question,
      options: p.options,
      urgency: p.urgency,
    }));
  }

  /**
   * Surface an approval request to the user. Used both by:
   *   - PreToolUse hook (when a destructive command is detected) — origin 'pre-tool-use'
   *   - request_user_approval MCP tool (when an agent voluntarily asks) — origin 'mcp'
   * The promise resolves with 'allow' or 'deny' once a caller invokes
   * `resolveApproval(id, decision)`.
   */
  requestApproval(req: {
    role: Role;
    toolName?: string | null;
    toolInput?: unknown;
    action: string;
    reason: string;
    summary?: string;
    origin: 'pre-tool-use' | 'mcp';
  }): Promise<{ decision: 'allow' | 'deny' }> {
    const id = randomUUID();
    return new Promise<{ decision: 'allow' | 'deny' }>((resolve) => {
      const entry: PendingApproval = {
        id,
        role: req.role,
        toolName: req.toolName ?? null,
        toolInput: req.toolInput,
        action: req.action,
        reason: req.reason,
        summary: req.summary ?? req.action,
        origin: req.origin,
        resolve: (decision) => resolve({ decision }),
      };
      this.pendingApprovals.set(id, entry);
      log('info', 'approval.requested', {
        id,
        role: req.role,
        origin: req.origin,
        reason: req.reason,
      });
      this.emit('approval-requested', {
        id,
        role: entry.role,
        toolName: entry.toolName,
        action: entry.action,
        reason: entry.reason,
        summary: entry.summary,
        origin: entry.origin,
      } satisfies PendingApprovalView);
    });
  }

  resolveApproval(id: string, decision: 'allow' | 'deny'): boolean {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    this.pendingApprovals.delete(id);
    log('info', 'approval.resolved', { id, decision });
    pending.resolve(decision);
    this.emit('approval-resolved', { id, decision });
    return true;
  }

  listPendingApprovals(): PendingApprovalView[] {
    return Array.from(this.pendingApprovals.values()).map((p) => ({
      id: p.id,
      role: p.role,
      toolName: p.toolName,
      action: p.action,
      reason: p.reason,
      summary: p.summary,
      origin: p.origin,
    }));
  }

  getProjectState(): ProjectState {
    if (!this.projectState) throw new Error('orchestrator not started');
    return this.projectState;
  }

  /** Update in-memory project state and write it to disk. */
  async updateProjectState(updates: Partial<ProjectState>): Promise<void> {
    if (!this.projectState || !this.statePath) {
      throw new Error('orchestrator not started');
    }
    Object.assign(this.projectState, updates);
    await writeProjectState(this.statePath, this.projectState);
    this.emit('project-state-updated', this.projectState);
  }

  async start(): Promise<StartResult> {
    this.workspace = await installWorkspace(this.options.cwd);

    const detection = await detectProject(this.options.cwd);
    this.statePath = detection.statePath;
    if (detection.kind === 'existing') {
      this.projectState = detection.state;
      // Restore FSM phase from persisted project state. Tag is always 'idle'
      // on a fresh start — no agent is mid-turn at boot.
      this.state = { tag: 'idle', phase: detection.state.phase };
      log('info', 'project.resumed', {
        phase: detection.state.phase,
        supervisorSessionId: detection.state.supervisorSessionId,
        developerSessionId: detection.state.developerSessionId,
      });
    } else {
      this.projectState = newProjectState();
      await writeProjectState(detection.statePath, this.projectState);
      log('info', 'project.initialized', { statePath: detection.statePath });
    }

    const { server, url } = await startHookServer({
      onStop: (role, payload) => {
        log('info', 'hook.stop', { role });
        this.emit('hook:stop', { role, payload });
      },
      onPreToolUse: async (role, payload) => {
        const policy = evaluatePolicy({
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
        });
        log('info', 'hook.pretool', {
          role,
          tool: payload.tool_name,
          decision: policy.action,
          reason: policy.reason,
        });
        this.emit('hook:pretool', {
          role,
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
          policy: policy.action,
          reason: policy.reason,
        });
        if (policy.action === 'allow') {
          return { decision: 'allow' };
        }
        const result = await this.requestApproval({
          role,
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
          action: `${payload.tool_name}: ${policy.summary ?? ''}`,
          reason: policy.reason ?? 'destructive operation',
          summary: policy.summary ?? '',
          origin: 'pre-tool-use',
        });
        if (result.decision === 'allow') {
          return { decision: 'allow' };
        }
        return {
          decision: 'deny',
          reason: `Blocked by SelfClaude (${policy.reason ?? 'destructive operation'}); user denied approval.`,
        };
      },
      onUserPromptSubmit: (role, _payload) => {
        const drained = this.messages.drain(role);
        if (drained.length === 0) return '';
        log('info', 'hook.prompt.injected', { role, count: drained.length });
        return drained
          .map((m) => `[from ${m.source} @ ${new Date(m.ts).toISOString()}]\n${m.body}`)
          .join('\n\n---\n\n');
      },
      onAskUser: (req) => this.askUser(req),
      onRequestApproval: (req) =>
        this.requestApproval({
          role: req.role,
          action: req.action,
          reason: req.reason,
          summary: req.action,
          origin: 'mcp',
        }),
      onWritePhaseDoc: (req) => this.writePhaseDoc(req),
    });
    this.hookServer = server;
    this.hookUrl = url;
    log('info', 'orchestrator.started', { hookUrl: url });
    return { existing: detection.kind === 'existing', projectState: this.projectState };
  }

  /**
   * Write a phase doc into `<cwd>/docs/phases/<filename>`. Filename is
   * slug-validated upstream by zod; this method additionally guards against
   * path traversal (filename containing slashes or `..`) before writing.
   */
  async writePhaseDoc(req: WritePhaseDocHttpRequest): Promise<{ path: string }> {
    if (!this.workspace) throw new Error('orchestrator not started');
    const safe = normalize(req.filename);
    if (
      safe !== req.filename ||
      safe.includes('/') ||
      safe.includes('\\') ||
      safe.startsWith('..') ||
      isAbsolute(safe)
    ) {
      throw new Error(`unsafe phase-doc filename: ${req.filename}`);
    }
    const phasesDir = join(this.workspace.cwd, 'docs', 'phases');
    await mkdir(phasesDir, { recursive: true });
    const target = join(phasesDir, safe);
    const ensureRel = relative(phasesDir, target);
    if (ensureRel.startsWith('..') || isAbsolute(ensureRel)) {
      throw new Error(`unsafe phase-doc path: ${target}`);
    }
    await writeFile(target, req.content);
    log('info', 'mcp.write_phase_doc', {
      role: req.role,
      filename: req.filename,
      bytes: req.content.length,
    });
    if (this.projectState && !this.projectState.phaseDocs.includes(req.filename)) {
      this.projectState.phaseDocs = [...this.projectState.phaseDocs, req.filename];
      if (this.statePath) {
        await writeProjectState(this.statePath, this.projectState);
      }
    }
    this.emit('phase-doc-written', {
      role: req.role,
      filename: req.filename,
      path: target,
    });
    return { path: target };
  }

  async stop(): Promise<void> {
    for (const [id, p] of this.pendingQuestions) {
      log('warn', 'orchestrator.stopping_pending_question_aborted', { id });
      p.resolve('');
    }
    this.pendingQuestions.clear();
    for (const [id, p] of this.pendingApprovals) {
      log('warn', 'orchestrator.stopping_pending_approval_denied', { id });
      p.resolve('deny');
    }
    this.pendingApprovals.clear();
    if (this.hookServer) {
      await this.hookServer.close();
      this.hookServer = null;
    }
    log('info', 'orchestrator.stopped');
  }
}
