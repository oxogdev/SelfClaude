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

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: { name: string; isDir: boolean; isHidden: boolean }[];
}

export interface Favorite {
  cwd: string;
  label: string;
  pinnedAt: number;
}

// Chat-log entry types (match packages/core/src/project/chat-log.ts).
export type ChatLogEntry =
  | { type: 'user-message'; text: string; ts: number }
  | { type: 'sup-message'; text: string; ts: number }
  | { type: 'dev-text'; text: string; ts: number }
  | {
      type: 'dev-tool-call';
      id: string;
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      ts: number;
    }
  | { type: 'dev-tool-result'; toolUseId: string; text: string; isError: boolean; ts: number }
  | { type: 'task-marker'; summary: string; ts: number }
  | { type: 'turn-marker'; turnIndex: number; who: 'sup' | 'dev'; ts: number }
  | { type: 'phase-doc-written'; filename: string; ts: number }
  | { type: 'question'; id: string; text: string; options?: string[]; ts: number }
  | { type: 'question-resolved'; id: string; answer: string; ts: number }
  | { type: 'approval'; id: string; action: string; reason: string; ts: number }
  | { type: 'approval-resolved'; id: string; decision: 'allow' | 'deny'; ts: number }
  | { type: 'iteration-end'; iteration: number; ts: number }
  | { type: 'user-note-dev'; text: string; ts: number }
  | { type: 'user-message-dev'; text: string; ts: number };

// Session SSE events (match packages/core/src/server/session-manager.ts).
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
  | { kind: 'dev-text-delta'; delta: string; ts: number };

export interface SessionSnapshot {
  meta: SessionMeta;
  chatLog: ChatLogEntry[];
  pendingQuestions: PendingQuestion[];
  pendingApprovals: PendingApproval[];
}
