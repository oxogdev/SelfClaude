import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MessageBus } from './message-bus.js';
import { initialState, transition, type FsmEvent, type FsmState } from './state-machine.js';
import { evaluatePolicy } from './policy.js';
import { checkBashSafety } from './bash-safety.js';
import { FileLockManager } from './file-locks.js';
import {
  buildOverrideRequiredMessage,
  buildRetryMessage,
  pickContractForFilename,
  validatePhaseDoc,
  type PhaseContractAttemptEvent,
} from './phase-contracts.js';
import { startHookServer } from '../hooks/server.js';
import { installWorkspace, type WorkspacePaths } from '../hooks/installer.js';
import type { Role } from '../hooks/types.js';
import type {
  ApplyAgentDnaHttpRequest,
  ApplyAgentDnaHttpResponse,
  AskUserHttpRequest,
  ConfirmItemDoneHttpRequest,
  PhaseTrackerHttpResponse,
  ProposeItemDoneHttpRequest,
  ProposeScriptHttpRequest,
  ProposeScriptHttpResponse,
  RegisterPhaseItemsHttpRequest,
  RejectItemDoneHttpRequest,
  RequestApprovalHttpRequest,
  WritePhaseDocHttpRequest,
} from '../mcp/types.js';
import { applyAgentDna, listDnaTemplates } from '../agents/dna.js';
import { clearPromptCache } from '../agents/registry.js';
import { detectProject } from '../project/detect.js';
import {
  appendItemNote,
  computeConfirmEvidence,
  mergePhaseRegistration,
  readPhases,
  writePhases,
  type ConfirmEvidence,
  type PhasesFile,
} from '../project/phases-store.js';
import { readChatLog } from '../project/chat-log.js';
import {
  readMcpTelemetry,
  recordMcpCall,
  writeMcpTelemetry,
  type MCPTelemetryFile,
} from '../project/mcp-telemetry-store.js';
import {
  isValidSlug as isValidScriptSlug,
  readScripts,
  removeApprovedScript,
  writeApprovedScript,
  writeScripts,
  type ScriptProposal,
  type ScriptsFile,
} from '../project/scripts-store.js';
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
  /**
   * Specialist identity tag forwarded to the hook scripts so the
   * orchestrator can distinguish e.g. `developer` vs `ui-dev` when
   * multiple subprocesses run concurrently. CC's hook protocol only
   * carries `role` (sup/dev), so this side channel via env → query
   * param fills the gap. Defaults to the role when unset.
   */
  SELFCLAUDE_AGENT: string;
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
  /**
   * Per-orchestrator file-lock manager. Hot for parallel agent
   * dispatch (when sup spawns ui-dev + developer to edit different
   * files concurrently). Currently serial-execution makes contention
   * rare; the manager still records who is touching what so the
   * session-manager can surface lock state in the UI.
   */
  readonly fileLocks = new FileLockManager();
  private state: FsmState = initialState();
  private hookServer: FastifyInstance | null = null;
  private workspace: WorkspacePaths | null = null;
  private hookUrl: string | null = null;
  /**
   * fs.watch on `<cwd>/.selfclaude/` filtering for `phases.json` change
   * events. Defends against the case where the supervisor edits the
   * tracker file directly with the `Write` tool instead of going
   * through the MCP API — without the watcher the panel would only
   * refresh on a hard reload. Debounced because fs.watch can fire
   * multiple events per single write.
   */
  private phaseWatcher: FSWatcher | null = null;
  private phaseWatchDebounce: NodeJS.Timeout | null = null;
  private lastPhaseEmitMs = 0;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private projectState: ProjectState | null = null;
  private statePath: string | null = null;
  /**
   * Per-filename attempt counter for phase-contract validation. Each
   * failed `write_phase_doc` increments; a successful (or override)
   * write resets to zero. After the contract's retry cap, the next
   * failed attempt surfaces the override-required error so sup stops
   * retrying autonomously and asks the operator instead.
   *
   * Lives in-memory: counters reset across orchestrator restarts,
   * which is the right behaviour — a restart is a clean slate, sup
   * gets the full retry budget again.
   */
  private readonly phaseDocAttempts = new Map<string, number>();

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

  hookEnv(role: Role, agent?: string): HookEnv {
    if (!this.hookUrl) throw new Error('orchestrator not started');
    return {
      SELFCLAUDE_ORCH_URL: this.hookUrl,
      SELFCLAUDE_ROLE: role,
      SELFCLAUDE_AGENT: agent ?? role,
    };
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
      onStop: (role, agent, payload) => {
        log('info', 'hook.stop', { role, agent });
        this.emit('hook:stop', { role, agent, payload });
        // Release every file lock the just-finished agent was holding.
        // `agent` is the specialist identity forwarded via env → query
        // param; falls back to role for legacy single-agent flows.
        this.fileLocks.releaseAll(agent);
      },
      onPreToolUse: async (role, agent, payload) => {
        // File-lock check first: if another agent is mid-edit on this
        // path, deny the call with a clear reason so the model can
        // either wait (next turn) or pick a different file. Critical
        // once parallel dispatch lands; harmless overhead in serial
        // mode (the locking agent is always the same one that's writing).
        if (payload.tool_name === 'Write' || payload.tool_name === 'Edit') {
          const path = (payload.tool_input as { file_path?: unknown })?.file_path;
          if (typeof path === 'string' && path.length > 0) {
            const result = this.fileLocks.tryAcquire(agent, path);
            if (!result.ok) {
              log('warn', 'hook.file_locked', {
                role,
                agent,
                path,
                heldBy: result.heldBy,
              });
              return {
                decision: 'deny',
                reason:
                  `File "${path}" is being edited by agent "${result.heldBy}" right now. ` +
                  `Wait for them to finish (their lock releases when their turn ends) or ` +
                  `coordinate via <ROOM> if you need to touch the same file.`,
              };
            }
          }
        }
        // Defence-in-depth Bash hang check — runs BEFORE the policy engine
        // so a banned long-runner is rejected with a teach-the-model
        // reason rather than escalated to a user approval prompt.
        if (payload.tool_name === 'Bash') {
          const issue = checkBashSafety(payload.tool_input);
          if (issue) {
            log('warn', 'hook.bash.unsafe', {
              role,
              agent,
              reason: issue.reason,
            });
            this.emit('hook:pretool', {
              role,
              agent,
              toolName: payload.tool_name,
              toolInput: payload.tool_input,
              policy: 'deny',
              reason: issue.reason,
            });
            return {
              decision: 'deny',
              reason: `${issue.reason} ${issue.hint}`,
            };
          }
        }
        const policy = evaluatePolicy({
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
        });
        log('info', 'hook.pretool', {
          role,
          agent,
          tool: payload.tool_name,
          decision: policy.action,
          reason: policy.reason,
        });
        this.emit('hook:pretool', {
          role,
          agent,
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
      onUserPromptSubmit: (role, _agent, _payload) => {
        const drained = this.messages.drain(role);
        if (drained.length === 0) return '';
        log('info', 'hook.prompt.injected', { role, count: drained.length });
        return drained
          .map((m) => `[from ${m.source} @ ${new Date(m.ts).toISOString()}]\n${m.body}`)
          .join('\n\n---\n\n');
      },
      // Each MCP handler is wrapped to record telemetry on completion.
      // The recordTelemetry call is fire-and-forget — failures don't
      // block the user-facing response. Success/failure mapping:
      //   - ask_user: any returned answer is success.
      //   - request_user_approval: 'allow' = success, 'deny' = failure.
      //   - phase tracker family: result.ok is authoritative.
      //   - apply_agent_dna: result.ok is authoritative.
      onAskUser: async (req) => {
        const result = await this.askUser(req);
        void this.recordTelemetry({
          name: 'ask_user',
          agent: req.role,
          success: true,
        });
        return result;
      },
      onRequestApproval: async (req) => {
        const result = await this.requestApproval({
          role: req.role,
          action: req.action,
          reason: req.reason,
          summary: req.action,
          origin: 'mcp',
        });
        void this.recordTelemetry({
          name: 'request_user_approval',
          agent: req.role,
          success: result.decision === 'allow',
          message: result.decision === 'deny' ? 'denied' : '',
        });
        return result;
      },
      onWritePhaseDoc: async (req) => {
        const result = await this.writePhaseDoc(req);
        void this.recordTelemetry({
          name: 'write_phase_doc',
          agent: req.role,
          success: true,
          message: req.filename,
        });
        return result;
      },
      onRegisterPhaseItems: async (req) => {
        const result = await this.registerPhaseItems(req);
        void this.recordTelemetry({
          name: 'register_phase_items',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
      onProposeItemDone: async (req) => {
        const result = await this.proposeItemDone(req);
        void this.recordTelemetry({
          name: 'propose_item_done',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
      onConfirmItemDone: async (req) => {
        const result = await this.confirmItemDone(req);
        void this.recordTelemetry({
          name: 'confirm_item_done',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
      onRejectItemDone: async (req) => {
        const result = await this.rejectItemDone(req);
        void this.recordTelemetry({
          name: 'reject_item_done',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
      onApplyAgentDna: async (req) => {
        const result = await this.applyAgentDna(req);
        void this.recordTelemetry({
          name: 'apply_agent_dna',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
      onProposeScript: async (req) => {
        const result = await this.proposeScript(req);
        void this.recordTelemetry({
          name: 'propose_script',
          agent: req.agent,
          success: result.ok,
          message: result.message,
        });
        return result;
      },
    });
    this.hookServer = server;
    this.hookUrl = url;
    this.startPhaseWatcher();
    log('info', 'orchestrator.started', { hookUrl: url });
    return { existing: detection.kind === 'existing', projectState: this.projectState };
  }

  /**
   * Watch `.selfclaude/phases.json` for any change — including direct
   * `Write` from the supervisor, which bypasses our MCP handlers and
   * would otherwise leave the UI stale until a hard reload. We watch
   * the parent directory (file may not exist yet at boot) and filter
   * for `phases.json` events; on change, re-read the file and emit a
   * `phase-tracker-updated` event tagged `external-edit`.
   *
   * Debounced 250ms because fs.watch typically fires multiple events
   * per single write (rename + change on macOS, multiple changes on
   * Linux). Also de-duped against the orchestrator's own writes by
   * tracking `lastPhaseEmitMs` — when one of our MCP handlers wrote,
   * the watcher fires too but we ignore it (avoiding double SSE).
   */
  private startPhaseWatcher(): void {
    if (!this.workspace) return;
    const dir = join(this.workspace.cwd, '.selfclaude');
    try {
      this.phaseWatcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename !== 'phases.json') return;
        if (this.phaseWatchDebounce) clearTimeout(this.phaseWatchDebounce);
        this.phaseWatchDebounce = setTimeout(() => {
          // Skip if our own MCP write just emitted — within 500ms of
          // an own emit, treat as our event, not external.
          if (Date.now() - this.lastPhaseEmitMs < 500) return;
          this.handleExternalPhaseEdit().catch((e: unknown) => {
            log('warn', 'phase-tracker.watcher_failed', {
              reason: (e as Error).message,
            });
          });
        }, 250);
      });
      log('info', 'phase-tracker.watcher_started', { dir });
    } catch (e) {
      // Directory may not exist yet on a fresh project — that's fine,
      // the directory gets created when sup writes the first file, and
      // we'd need a recursive watcher for true coverage there. For now
      // log and skip; the MCP path still works.
      log('warn', 'phase-tracker.watcher_unavailable', {
        dir,
        reason: (e as Error).message,
      });
    }
  }

  private async handleExternalPhaseEdit(): Promise<void> {
    if (!this.workspace) return;
    const file = await readPhases(this.workspace.cwd);
    log('info', 'phase-tracker.external_edit_detected', {
      phases: file.phases.length,
    });
    this.emit('phase-tracker-updated', {
      kind: 'external-edit',
      slug: '',
      file,
    });
  }

  /**
   * Write a phase doc into `<cwd>/docs/phases/<filename>`. Filename is
   * slug-validated upstream by zod; this method additionally guards against
   * path traversal (filename containing slashes or `..`) before writing.
   *
   * Phase-contract validation (Phase 1 — Determinism): if a contract
   * applies to this filename, the body is validated against required
   * sections + minimum bullet/word counts. On failure we throw a
   * structured error that the MCP bridge surfaces back to sup as the
   * tool result; sup naturally retries on its next turn with a
   * corrected body. After the contract's retry cap, the error message
   * pivots to "operator override required" so sup stops looping
   * autonomously.
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

    // Phase contract validation. No applicable contract → bypass.
    const contract = pickContractForFilename(req.filename);
    if (contract) {
      const result = validatePhaseDoc(req.content, contract);
      const prev = this.phaseDocAttempts.get(req.filename) ?? 0;
      const attemptNumber = prev + 1;
      const override = req.override === true;

      const event: PhaseContractAttemptEvent = {
        filename: req.filename,
        contractName: contract.name,
        attemptNumber,
        valid: result.valid,
        override,
        sectionsFound: result.sectionsFound,
        sectionsMissing: result.sectionsMissing,
        violationCount: result.violations.length,
        ts: Date.now(),
      };
      this.emit('phase-contract-attempt', event);
      log('info', 'phase-contract.attempt', {
        filename: req.filename,
        contract: contract.name,
        attempt: attemptNumber,
        valid: result.valid,
        override,
        missing: result.sectionsMissing,
        violations: result.violations.length,
      });

      if (!result.valid && !override) {
        this.phaseDocAttempts.set(req.filename, attemptNumber);
        const message =
          attemptNumber > contract.defaultRetryLimit
            ? buildOverrideRequiredMessage(result, contract, attemptNumber)
            : buildRetryMessage(result, contract, attemptNumber);
        throw new Error(message);
      }
      // Valid OR override: reset so a future re-write starts fresh.
      this.phaseDocAttempts.delete(req.filename);
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
      override: req.override === true,
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

  /* ───── Phase tracker handlers ─────
   *
   * These mutate `<cwd>/.selfclaude/phases.json` and emit
   * `phase-tracker-updated` so the SessionManager can fan it out as an
   * SSE event. They also enqueue inbox messages between the involved
   * agents so the next turn picks up the change without polling.
   */

  async registerPhaseItems(
    req: RegisterPhaseItemsHttpRequest,
  ): Promise<PhaseTrackerHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    if (req.role !== 'supervisor') {
      return {
        ok: false,
        message:
          'register_phase_items is supervisor-only. Specialist agents shouldn\'t define phase scope; ' +
          'ask the supervisor to register the items.',
      };
    }
    const current = await readPhases(this.workspace.cwd);
    const isReregistration = current.phases.some((p) => p.slug === req.slug);
    const next = mergePhaseRegistration(current, {
      slug: req.slug,
      title: req.title,
      items: req.items,
    });
    await writePhases(this.workspace.cwd, next);
    this.lastPhaseEmitMs = Date.now();
    log('info', 'phase-tracker.registered', {
      slug: req.slug,
      items: req.items.length,
      isReregistration,
    });
    this.emit('phase-tracker-updated', {
      kind: 'registered',
      slug: req.slug,
      title: req.title,
      itemCount: req.items.length,
      isReregistration,
      file: next,
    });
    return {
      ok: true,
      message: `Registered ${req.items.length} item(s) for phase "${req.slug}".`,
    };
  }

  async proposeItemDone(
    req: ProposeItemDoneHttpRequest,
  ): Promise<PhaseTrackerHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    const file = await readPhases(this.workspace.cwd);
    const phase = file.phases.find((p) => p.slug === req.slug);
    if (!phase) {
      return {
        ok: false,
        message: `No phase "${req.slug}" registered yet. Ask the supervisor to register it first.`,
      };
    }
    const item = phase.items.find((it) => it.id === req.itemId);
    if (!item) {
      return {
        ok: false,
        message:
          `No item "${req.itemId}" in phase "${req.slug}". Available: ` +
          `${phase.items.map((it) => it.id).join(', ') || '(none)'}.`,
      };
    }
    item.status = 'proposed';
    item.proposedBy = req.agent;
    item.proposedAt = new Date().toISOString();
    // Reset any prior evidence — a new proposal opens a fresh audit
    // window. The previous trail (if any) is already preserved in the
    // chat-log for historical lookup.
    item.confirmEvidence = null;
    if (req.notes) {
      item.notes = appendItemNote(item.notes, `${req.agent} (proposed)`, req.notes);
    }
    await writePhases(this.workspace.cwd, file);
    this.lastPhaseEmitMs = Date.now();
    log('info', 'phase-tracker.proposed', {
      slug: req.slug,
      itemId: req.itemId,
      agent: req.agent,
    });
    // Notify the supervisor so the next sup turn reviews this item.
    this.messages.enqueue({
      to: 'supervisor',
      source: 'developer',
      body:
        `PHASE_ITEM_PROPOSED:\n` +
        `phase: ${phase.title} (${req.slug})\n` +
        `item: ${item.title} (${req.itemId})\n` +
        `proposer: ${req.agent}\n` +
        (req.notes ? `notes: ${req.notes}\n` : '') +
        `\n→ Review the work, run any verification step the proposer suggested, then call ` +
        `\`confirm_item_done\` to mark it ✅ or \`reject_item_done\` with a reason.`,
    });
    this.emit('phase-tracker-updated', {
      kind: 'proposed',
      slug: req.slug,
      itemId: req.itemId,
      itemTitle: item.title,
      agent: req.agent,
      notes: req.notes ?? '',
      file,
    });
    return {
      ok: true,
      message:
        `Item "${req.itemId}" proposed as done. Supervisor notified — they'll review on their next turn.`,
    };
  }

  async confirmItemDone(
    req: ConfirmItemDoneHttpRequest,
  ): Promise<PhaseTrackerHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    if (req.role !== 'supervisor') {
      return {
        ok: false,
        message: 'confirm_item_done is supervisor-only.',
      };
    }
    const file = await readPhases(this.workspace.cwd);
    const phase = file.phases.find((p) => p.slug === req.slug);
    if (!phase) return { ok: false, message: `No phase "${req.slug}".` };
    const item = phase.items.find((it) => it.id === req.itemId);
    if (!item)
      return { ok: false, message: `No item "${req.itemId}" in phase "${req.slug}".` };
    const proposer = item.proposedBy;
    const confirmedAtMs = Date.now();
    // Audit trail: scan chat-log for sup tool calls in the propose →
    // confirm window. If the item was confirmed without a prior
    // proposal (rare, sup confirms its own work), fall back to a
    // 30-second window before now so we still capture *something*.
    const proposedAtMs = item.proposedAt
      ? Date.parse(item.proposedAt)
      : confirmedAtMs - 30_000;
    let evidence: ConfirmEvidence | null = null;
    try {
      const log_entries = await readChatLog(this.workspace.cwd);
      evidence = computeConfirmEvidence(log_entries, proposedAtMs, confirmedAtMs);
    } catch (e) {
      log('warn', 'phase-tracker.evidence_compute_failed', {
        reason: (e as Error).message,
      });
    }
    item.status = 'done';
    item.confirmedBy = req.agent;
    item.confirmedAt = new Date(confirmedAtMs).toISOString();
    item.confirmEvidence = evidence;
    if (req.notes) {
      item.notes = appendItemNote(item.notes, `${req.agent} (confirmed)`, req.notes);
    }
    await writePhases(this.workspace.cwd, file);
    this.lastPhaseEmitMs = Date.now();
    log('info', 'phase-tracker.confirmed', {
      slug: req.slug,
      itemId: req.itemId,
      proposer,
      evidenceCount: evidence?.totalCount ?? 0,
    });
    // Notify the original proposer so they get the green light on their next turn.
    if (proposer) {
      this.messages.enqueue({
        to: 'developer', // bus only knows two channels; specialists drain through `developer`
        source: 'supervisor',
        body:
          `PHASE_ITEM_CONFIRMED:\n` +
          `phase: ${phase.title} (${req.slug})\n` +
          `item: ${item.title} (${req.itemId})\n` +
          (req.notes ? `confirmer notes: ${req.notes}\n` : '') +
          `\n→ Marked done. Move to the next item.`,
      });
    }
    this.emit('phase-tracker-updated', {
      kind: 'confirmed',
      slug: req.slug,
      itemId: req.itemId,
      itemTitle: item.title,
      confirmer: req.agent,
      proposer,
      evidence,
      notes: req.notes ?? '',
      file,
    });
    // Soft signal back to the sup: if the trail is empty, surface a
    // visible note in the tool result so the model sees the operator
    // will see ⚠ next to this item.
    const evidenceWarn =
      evidence && evidence.totalCount === 0
        ? ' ⚠ No Read/Bash/Edit recorded between propose and confirm — operator will see an empty audit trail. Be explicit in your notes about what you actually did to verify.'
        : '';
    return {
      ok: true,
      message: `Item "${req.itemId}" confirmed done.${evidenceWarn}`,
    };
  }

  async rejectItemDone(
    req: RejectItemDoneHttpRequest,
  ): Promise<PhaseTrackerHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    if (req.role !== 'supervisor') {
      return {
        ok: false,
        message: 'reject_item_done is supervisor-only.',
      };
    }
    const file = await readPhases(this.workspace.cwd);
    const phase = file.phases.find((p) => p.slug === req.slug);
    if (!phase) return { ok: false, message: `No phase "${req.slug}".` };
    const item = phase.items.find((it) => it.id === req.itemId);
    if (!item)
      return { ok: false, message: `No item "${req.itemId}" in phase "${req.slug}".` };
    const proposer = item.proposedBy;
    item.status = 'pending';
    // Keep proposer/proposedAt blank so a new proposal needs a fresh round-trip.
    item.proposedBy = null;
    item.proposedAt = null;
    const itemTitle = item.title;
    item.notes = appendItemNote(item.notes, `${req.agent} (rejected)`, req.reason);
    await writePhases(this.workspace.cwd, file);
    this.lastPhaseEmitMs = Date.now();
    log('info', 'phase-tracker.rejected', {
      slug: req.slug,
      itemId: req.itemId,
      proposer,
    });
    if (proposer) {
      this.messages.enqueue({
        to: 'developer',
        source: 'supervisor',
        body:
          `PHASE_ITEM_REJECTED:\n` +
          `phase: ${phase.title} (${req.slug})\n` +
          `item: ${item.title} (${req.itemId})\n` +
          `reason: ${req.reason}\n` +
          `\n→ Address the issue, then call \`propose_item_done\` again.`,
      });
    }
    this.emit('phase-tracker-updated', {
      kind: 'rejected',
      slug: req.slug,
      itemId: req.itemId,
      itemTitle,
      rejector: req.agent,
      proposer,
      reason: req.reason,
      file,
    });
    return {
      ok: true,
      message: `Item "${req.itemId}" rejected and returned to pending.`,
    };
  }

  /** Snapshot of the current phase tracker. Used by the SessionManager
   * to hydrate the UI on connect and on `phase-tracker-updated` events. */
  async getPhaseTracker(): Promise<PhasesFile> {
    if (!this.workspace) throw new Error('orchestrator not started');
    return readPhases(this.workspace.cwd);
  }

  /**
   * Record one MCP tool invocation in the per-project telemetry file.
   * Wraps every MCP handler — see the per-handler call sites below.
   * Failures are swallowed: telemetry shouldn't block the user-facing
   * tool response if the JSON write fails.
   */
  private async recordTelemetry(args: {
    name: string;
    agent: string;
    success: boolean;
    message?: string;
  }): Promise<void> {
    if (!this.workspace) return;
    try {
      const file = await readMcpTelemetry(this.workspace.cwd);
      const next = recordMcpCall(file, args);
      await writeMcpTelemetry(this.workspace.cwd, next);
      this.emit('mcp-telemetry-updated', { file: next });
    } catch (e) {
      log('warn', 'mcp.telemetry.write_failed', {
        reason: (e as Error).message,
      });
    }
  }

  /** Read the current telemetry snapshot (Settings panel hydrator). */
  async getMcpTelemetry(): Promise<MCPTelemetryFile> {
    if (!this.workspace) throw new Error('orchestrator not started');
    return readMcpTelemetry(this.workspace.cwd);
  }

  /* ───── Bash macro / script proposal handlers ─────
   *
   * The lifecycle: sup proposes via MCP → operator reviews via REST →
   * approved scripts land on disk and become callable through the
   * regular `Bash` tool. The Operator-side review uses the REST
   * methods (approveScriptProposal / rejectScriptProposal) directly,
   * not via MCP — only the agent-facing path is MCP.
   */

  async proposeScript(req: ProposeScriptHttpRequest): Promise<ProposeScriptHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    if (req.role !== 'supervisor') {
      return {
        ok: false,
        message:
          'propose_script is supervisor-only. Specialist agents should ask sup to add a ' +
          'script when they need one.',
      };
    }
    if (!isValidScriptSlug(req.slug)) {
      return {
        ok: false,
        message: `Invalid slug "${req.slug}". Use kebab-case: a-z, 0-9, hyphens (e.g. "check-types").`,
      };
    }
    const file = await readScripts(this.workspace.cwd);
    const existing = file.scripts.find((s) => s.slug === req.slug);
    if (existing && existing.status === 'approved') {
      return {
        ok: false,
        message:
          `Slug "${req.slug}" is already approved. If you need to change the script body, ` +
          `propose a new slug or ask the operator to delete the existing one first.`,
      };
    }
    const proposal: ScriptProposal = {
      slug: req.slug,
      body: req.body,
      reason: req.reason,
      status: 'pending',
      proposedBy: req.agent,
      proposedAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      reviewerNotes: '',
    };
    // Replace existing pending/rejected entry with the same slug; append otherwise.
    const next: ScriptsFile = {
      ...file,
      scripts: existing
        ? file.scripts.map((s) => (s.slug === req.slug ? proposal : s))
        : [...file.scripts, proposal],
    };
    await writeScripts(this.workspace.cwd, next);
    log('info', 'scripts.proposed', { slug: req.slug, agent: req.agent });
    this.emit('scripts-updated', { kind: 'proposed', slug: req.slug, file: next });
    return {
      ok: true,
      message:
        `Script "${req.slug}" proposed for review. The operator gets a notification in the ` +
        `Scripts panel; once approved you can call it via \`Bash ./.selfclaude/scripts/${req.slug}.sh\`. ` +
        `If you need this immediately, ask the operator to review it.`,
    };
  }

  async approveScriptProposal(slug: string, operator: string, notes?: string):
    Promise<{ ok: boolean; message: string }> {
    if (!this.workspace) throw new Error('orchestrator not started');
    const file = await readScripts(this.workspace.cwd);
    const proposal = file.scripts.find((s) => s.slug === slug);
    if (!proposal) return { ok: false, message: `No proposal "${slug}".` };
    if (proposal.status === 'approved') {
      return { ok: true, message: `Already approved.` };
    }
    const reviewedAt = new Date().toISOString();
    const updated: ScriptProposal = {
      ...proposal,
      status: 'approved',
      reviewedBy: operator,
      reviewedAt,
      reviewerNotes: notes?.trim() ?? '',
    };
    const next: ScriptsFile = {
      ...file,
      scripts: file.scripts.map((s) => (s.slug === slug ? updated : s)),
    };
    await writeApprovedScript(this.workspace.cwd, updated);
    await writeScripts(this.workspace.cwd, next);
    // Tell sup it's available now.
    this.messages.enqueue({
      to: 'supervisor',
      source: 'user',
      body:
        `SCRIPT_APPROVED: "${slug}" was approved by ${operator}. ` +
        `Invoke via \`Bash ./.selfclaude/scripts/${slug}.sh\`.${
          notes ? `\nReviewer notes: ${notes}` : ''
        }`,
    });
    log('info', 'scripts.approved', { slug, operator });
    this.emit('scripts-updated', { kind: 'approved', slug, file: next });
    return { ok: true, message: `Approved "${slug}". Sup will see the notification next turn.` };
  }

  async rejectScriptProposal(slug: string, operator: string, reason: string):
    Promise<{ ok: boolean; message: string }> {
    if (!this.workspace) throw new Error('orchestrator not started');
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return { ok: false, message: 'Reject requires a reason — sup needs to know what to fix.' };
    }
    const file = await readScripts(this.workspace.cwd);
    const proposal = file.scripts.find((s) => s.slug === slug);
    if (!proposal) return { ok: false, message: `No proposal "${slug}".` };
    if (proposal.status === 'approved') {
      // Revoking an already-approved script: remove the file too.
      await removeApprovedScript(this.workspace.cwd, slug);
    }
    const reviewedAt = new Date().toISOString();
    const updated: ScriptProposal = {
      ...proposal,
      status: 'rejected',
      reviewedBy: operator,
      reviewedAt,
      reviewerNotes: trimmed,
    };
    const next: ScriptsFile = {
      ...file,
      scripts: file.scripts.map((s) => (s.slug === slug ? updated : s)),
    };
    await writeScripts(this.workspace.cwd, next);
    this.messages.enqueue({
      to: 'supervisor',
      source: 'user',
      body:
        `SCRIPT_REJECTED: "${slug}" was rejected by ${operator}.\nReason: ${trimmed}\n` +
        `Don't propose this slug again unless you address the feedback. Find another way ` +
        `or propose a different slug.`,
    });
    log('info', 'scripts.rejected', { slug, operator });
    this.emit('scripts-updated', { kind: 'rejected', slug, file: next });
    return { ok: true, message: `Rejected "${slug}". Sup will see the reason next turn.` };
  }

  /** Snapshot of the scripts index for the UI. */
  async getScripts(): Promise<ScriptsFile> {
    if (!this.workspace) throw new Error('orchestrator not started');
    return readScripts(this.workspace.cwd);
  }

  /**
   * Operator-side override that resolves an empty-evidence ⚠ on a
   * `done` item. Called from the web UI's "Mark as operator-verified"
   * button when the operator has manually inspected the work. Records
   * the trail (who, when, optional notes) on the item itself and emits
   * the standard `phase-tracker-updated` event so the panel refreshes.
   *
   * No-op (returns ok:true) when the item is already operator-verified.
   * Validates that the item exists and is in `done` status — pending /
   * proposed items can't be operator-verified (the operator should
   * either confirm via sup or wait for the proper flow).
   */
  async operatorVerifyItem(req: {
    slug: string;
    itemId: string;
    operator?: string;
    notes?: string;
  }): Promise<{ ok: boolean; message: string }> {
    if (!this.workspace) throw new Error('orchestrator not started');
    const file = await readPhases(this.workspace.cwd);
    const phase = file.phases.find((p) => p.slug === req.slug);
    if (!phase) return { ok: false, message: `No phase "${req.slug}".` };
    const item = phase.items.find((it) => it.id === req.itemId);
    if (!item)
      return { ok: false, message: `No item "${req.itemId}" in phase "${req.slug}".` };
    if (item.status !== 'done') {
      return {
        ok: false,
        message:
          `Item "${req.itemId}" is "${item.status}", not "done". Operator-verify only ` +
          `applies to confirmed-but-empty-trail items.`,
      };
    }
    const operator = req.operator ?? 'operator';
    item.operatorVerifiedAt = new Date().toISOString();
    item.operatorVerifiedBy = operator;
    if (req.notes) {
      item.notes = appendItemNote(item.notes, `${operator} (operator-verified)`, req.notes);
    }
    await writePhases(this.workspace.cwd, file);
    this.lastPhaseEmitMs = Date.now();
    log('info', 'phase-tracker.operator_verified', {
      slug: req.slug,
      itemId: req.itemId,
      operator,
    });
    this.emit('phase-tracker-updated', {
      kind: 'operator-verified',
      slug: req.slug,
      itemId: req.itemId,
      itemTitle: item.title,
      operator,
      notes: req.notes ?? '',
      file,
    });
    return {
      ok: true,
      message: `Item "${req.itemId}" marked as operator-verified.`,
    };
  }

  /**
   * Apply a bundled DNA template to this project. Sup-only — specialist
   * agents shouldn't reshape their own contract. Idempotent unless
   * `force: true`. On success, clears the prompt cache so the next
   * agent turn picks up the new addendum without a daemon restart.
   */
  async applyAgentDna(
    req: ApplyAgentDnaHttpRequest,
  ): Promise<ApplyAgentDnaHttpResponse> {
    if (!this.workspace) throw new Error('orchestrator not started');
    if (req.role !== 'supervisor') {
      return {
        ok: false,
        message:
          'apply_agent_dna is supervisor-only. Specialist agents do not reshape their own DNA.',
      };
    }
    const result = await applyAgentDna(this.workspace.cwd, req.dnaSlug, {
      force: req.force,
    });
    if (result.ok) {
      // Hot-pickup: invalidate cached prompts so the next agent turn
      // (typically the very next one, when sup hands off to ui-dev)
      // composes the addendum into its system prompt.
      clearPromptCache();
      log('info', 'agent-dna.applied', {
        slug: req.dnaSlug,
        agent: result.agent,
        destPath: result.destPath,
      });
      this.emit('agent-dna-applied', {
        slug: req.dnaSlug,
        agent: result.agent,
        destPath: result.destPath,
        label: result.label,
      });
      return {
        ok: true,
        message:
          `Applied "${result.label}" DNA to ${result.agent}. ` +
          `Wrote to ${result.destPath}. The next ${result.agent} turn picks it up automatically.`,
      };
    }
    if (result.reason === 'already-applied') {
      // Friendly no-op — sup re-running bootstrap shouldn't error.
      return { ok: true, message: result.message };
    }
    if (result.reason === 'unknown-template') {
      const available = listDnaTemplates()
        .map((t) => `- ${t.slug} (${t.label}, targets ${t.agent})`)
        .join('\n');
      return {
        ok: false,
        message: `${result.message}\n\nAvailable templates:\n${available || '(none)'}`,
      };
    }
    return { ok: false, message: result.message };
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
    if (this.phaseWatchDebounce) {
      clearTimeout(this.phaseWatchDebounce);
      this.phaseWatchDebounce = null;
    }
    if (this.phaseWatcher) {
      this.phaseWatcher.close();
      this.phaseWatcher = null;
    }
    if (this.hookServer) {
      await this.hookServer.close();
      this.hookServer = null;
    }
    log('info', 'orchestrator.stopped');
  }
}
