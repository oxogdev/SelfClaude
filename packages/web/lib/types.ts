// Mirror of @selfclaude/core public types. We re-declare here (rather than
// importing from the workspace package) so the web bundle stays free of
// node-only dependencies (fastify, grammy, etc).

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

export interface PendingQuestion {
  id: string;
  role: 'supervisor' | 'developer';
  question: string;
  options?: string[];
  urgency: 'low' | 'high';
}

export interface PendingApproval {
  id: string;
  role: 'supervisor' | 'developer';
  toolName: string | null;
  action: string;
  reason: string;
  summary: string;
  origin: 'pre-tool-use' | 'mcp';
}

export type ProjectSignal = 'git' | 'selfclaude' | 'node' | 'rust' | 'python' | 'go';

export interface BrowseEntry {
  name: string;
  isDir: boolean;
  isHidden: boolean;
  /** Project-anchor signals detected at the top level of this directory. */
  signals: ProjectSignal[];
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export interface Favorite {
  cwd: string;
  label: string;
  pinnedAt: number;
}

export interface RecentEntry {
  cwd: string;
  label: string;
  openedAt: number;
}

// Chat-log entry types (match packages/core/src/project/chat-log.ts).
export type ChatLogEntry =
  | { type: 'user-message'; text: string; ts: number }
  | { type: 'sup-message'; text: string; ts: number }
  | { type: 'dev-text'; text: string; ts: number }
  | { type: 'sup-thinking'; text: string; ts: number }
  | { type: 'dev-thinking'; text: string; ts: number }
  | {
      type: 'dev-tool-call';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | { type: 'dev-tool-result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | {
      type: 'sup-tool-call';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | { type: 'sup-tool-result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | { type: 'task-marker'; summary: string; ts: number }
  | { type: 'turn-marker'; turnIndex: number; who: 'sup' | 'dev'; ts: number }
  | { type: 'phase-doc-written'; filename: string; ts: number }
  | { type: 'question'; id: string; text: string; options?: string[]; ts: number }
  | { type: 'question-resolved'; id: string; answer: string; ts: number }
  | { type: 'approval'; id: string; action: string; reason: string; ts: number }
  | { type: 'approval-resolved'; id: string; decision: 'allow' | 'deny'; ts: number }
  | { type: 'iteration-end'; iteration: number; ts: number }
  | { type: 'user-note-dev'; text: string; ts: number }
  | { type: 'user-message-dev'; text: string; ts: number }
  | {
      type: 'wakeup-scheduled';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      fireAt: number;
      prompt: string;
      reason: string;
      ts: number;
    }
  | {
      type: 'wakeup-fired';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      ts: number;
    }
  | {
      type: 'wakeup-cancelled';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      reason: 'replaced' | 'user-input' | 'shutdown';
      ts: number;
    }
  | {
      type: 'wakeup-legacy-consumed';
      legacyToolUseId: string;
      wakeupId: string;
      ts: number;
    }
  | { type: 'agent-text'; agent: string; text: string; ts: number }
  | { type: 'agent-thinking'; agent: string; text: string; ts: number }
  | {
      type: 'agent-tool-call';
      agent: string;
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | {
      type: 'agent-tool-result';
      agent: string;
      toolUseId: string;
      text: string;
      isError: boolean;
      ts: number;
    }
  | { type: 'agent-summoned'; agent: string; ts: number }
  | { type: 'agent-dismissed'; agent: string; ts: number }
  | { type: 'verdict'; id: number; text: string; ts: number }
  | { type: 'room-message'; agent: string; text: string; ts: number }
  /* Phase tracker audit log — see core/src/project/chat-log.ts. */
  | {
      type: 'phase-registered';
      slug: string;
      title: string;
      itemCount: number;
      isReregistration: boolean;
      ts: number;
    }
  | {
      type: 'phase-item-proposed';
      slug: string;
      itemId: string;
      itemTitle: string;
      agent: string;
      notes: string;
      ts: number;
    }
  | {
      type: 'phase-item-confirmed';
      slug: string;
      itemId: string;
      itemTitle: string;
      confirmer: string;
      proposer: string | null;
      evidence: {
        reads: { path: string; ts: number }[];
        bashes: { command: string; ts: number; isError: boolean }[];
        edits: { path: string; ts: number }[];
        tsFrom: number;
        tsTo: number;
        totalCount: number;
      } | null;
      notes: string;
      ts: number;
    }
  | {
      type: 'phase-item-rejected';
      slug: string;
      itemId: string;
      itemTitle: string;
      rejector: string;
      proposer: string | null;
      reason: string;
      ts: number;
    }
  | {
      type: 'phase-item-operator-verified';
      slug: string;
      itemId: string;
      itemTitle: string;
      operator: string;
      notes: string;
      ts: number;
    };

// Session SSE events (match packages/core/src/server/session-manager.ts).
/* ───── Phase tracker types ─────
 *
 * Mirror of `packages/core/src/project/phases-store.ts`. Lives here so
 * SessionEvent can reference `PhaseTrackerFile` without an import cycle
 * back through `./api.ts`.
 */
export type PhaseItemStatus = 'pending' | 'proposed' | 'done';

/**
 * Evidence trail captured automatically when the supervisor confirms an
 * item. Empty arrays + `totalCount === 0` flag a drive-by confirm — the
 * UI surfaces a ⚠ next to the item.
 */
export interface ConfirmEvidence {
  reads: { path: string; ts: number }[];
  bashes: { command: string; ts: number; isError: boolean }[];
  edits: { path: string; ts: number }[];
  /** Window start = item.proposedAt (ms). */
  tsFrom: number;
  /** Window end = item.confirmedAt (ms). */
  tsTo: number;
  /** Sum of reads.length + bashes.length + edits.length. */
  totalCount: number;
}

export interface PhaseItem {
  id: string;
  title: string;
  status: PhaseItemStatus;
  proposedBy: string | null;
  proposedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Auto-captured tool-call trail; null until supervisor confirms. */
  confirmEvidence: ConfirmEvidence | null;
  /**
   * Operator override for empty-evidence ⚠. Set when the operator
   * inspected the work themselves and clicked "Mark operator-verified"
   * in the item detail modal.
   */
  operatorVerifiedAt: string | null;
  operatorVerifiedBy: string | null;
  notes: string;
}

export interface PhaseTrackerPhase {
  slug: string;
  title: string;
  items: PhaseItem[];
}

export interface PhaseTrackerFile {
  version: 1;
  updatedAt: string;
  phases: PhaseTrackerPhase[];
}

export type SessionEvent =
  | { kind: 'state-changed'; state: { tag: string; phase?: string } }
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
  | {
      kind: 'sup-tool-call';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | { kind: 'sup-tool-result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | { kind: 'task-marker'; summary: string; ts: number }
  | { kind: 'phase-doc-written'; filename: string; ts: number }
  | { kind: 'question'; question: PendingQuestion }
  | { kind: 'question-resolved'; id: string; answer: string }
  | { kind: 'approval'; approval: PendingApproval }
  | { kind: 'approval-resolved'; id: string; decision: 'allow' | 'deny' }
  | { kind: 'iteration-end'; iteration: number }
  | { kind: 'error'; message: string }
  | { kind: 'turn-busy'; busy: boolean }
  | { kind: 'user-note-dev'; text: string; ts: number }
  | { kind: 'user-message-dev'; text: string; ts: number }
  | { kind: 'sup-message-delta'; delta: string; ts: number }
  | { kind: 'dev-text-delta'; delta: string; ts: number }
  | { kind: 'sup-thinking-delta'; delta: string; ts: number }
  | { kind: 'dev-thinking-delta'; delta: string; ts: number }
  | { kind: 'sup-thinking'; text: string; ts: number }
  | { kind: 'dev-thinking'; text: string; ts: number }
  | {
      kind: 'role-metrics';
      /** Built-in roles or specialist agent name (`ui-dev`, `security`, …). */
      role: string;
      metrics: RoleMetrics;
      ts: number;
    }
  | {
      kind: 'wakeup-scheduled';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      fireAt: number;
      prompt: string;
      reason: string;
      ts: number;
    }
  | {
      kind: 'wakeup-fired';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      ts: number;
    }
  | {
      kind: 'wakeup-cancelled';
      wakeupId: string;
      role: 'supervisor' | 'developer';
      reason: 'replaced' | 'user-input' | 'shutdown';
      ts: number;
    }
  | { kind: 'agent-text'; agent: string; text: string; ts: number }
  | { kind: 'agent-text-delta'; agent: string; delta: string; ts: number }
  | { kind: 'agent-thinking'; agent: string; text: string; ts: number }
  | { kind: 'agent-thinking-delta'; agent: string; delta: string; ts: number }
  | {
      kind: 'agent-tool-call';
      agent: string;
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | {
      kind: 'agent-tool-result';
      agent: string;
      toolUseId: string;
      text: string;
      isError: boolean;
      ts: number;
    }
  | { kind: 'agent-summoned'; agent: string; ts: number }
  | { kind: 'agent-dismissed'; agent: string; ts: number }
  | { kind: 'verdict'; id: number; text: string; ts: number }
  | { kind: 'room-message'; agent: string; text: string; ts: number }
  /**
   * Phase tracker mutation. Carries the post-mutation snapshot inline
   * so the UI can update without a separate fetch. `logEntry` is the
   * matching chat-log entry the orchestrator just appended; the store
   * also pushes it into `chatLog` so the Audit Log panel sees the
   * mutation live without paginating.
   */
  | {
      kind: 'phase-tracker-updated';
      action: 'registered' | 'proposed' | 'confirmed' | 'rejected' | 'external-edit';
      slug: string;
      itemId?: string;
      agent?: string;
      file: PhaseTrackerFile;
      /** null on `external-edit` — file changed outside the MCP path. */
      logEntry: ChatLogEntry | null;
      ts: number;
    }
  /** Bash macro / script proposal lifecycle. */
  | {
      kind: 'scripts-updated';
      action: 'proposed' | 'approved' | 'rejected';
      slug: string;
      file: ScriptsFile;
      ts: number;
    };

/* ───── Scripts (Bash macros) types ───── */
export type ScriptProposalStatus = 'pending' | 'approved' | 'rejected';
export interface ScriptProposal {
  slug: string;
  body: string;
  reason: string;
  status: ScriptProposalStatus;
  proposedBy: string;
  proposedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNotes: string;
}
export interface ScriptsFile {
  version: 1;
  updatedAt: string;
  scripts: ScriptProposal[];
}

/** Per-role cost / time counters surfaced in the bottom toolbar. */
export interface RoleMetrics {
  totalCostUsd: number;
  totalTurns: number;
  lastTurnMs: number;
  totalDurationMs: number;
  lastResultAt: number | null;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  chatLog: ChatLogEntry[];
  pendingQuestions: PendingQuestion[];
  pendingApprovals: PendingApproval[];
  metrics: {
    sup: RoleMetrics;
    dev: RoleMetrics;
    agents: Record<string, RoleMetrics>;
  };
  hasMoreHistory: boolean;
}
