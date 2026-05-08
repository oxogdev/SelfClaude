'use client';

import { create } from 'zustand';
import type {
  ChatLogEntry,
  PendingApproval,
  PendingQuestion,
  PhaseTrackerFile,
  RoleMetrics,
  ScriptsFile,
  SessionEvent,
  SessionMeta,
} from './types';

export interface SessionState {
  meta: SessionMeta | null;
  chatLog: ChatLogEntry[];
  pendingQuestion: PendingQuestion | null;
  pendingApproval: PendingApproval | null;
  selectedToolUseId: string | null;
  busy: boolean;
  /** Timestamp of the currently-streaming sup bubble (null when settled). */
  streamingSupTs: number | null;
  /** Timestamp of the currently-streaming dev bubble (null when settled). */
  streamingDevTs: number | null;
  metrics: {
    sup: RoleMetrics;
    dev: RoleMetrics;
    agents: Record<string, RoleMetrics>;
  };
  /** True when older entries exist server-side past the loaded window. */
  hasMoreHistory: boolean;
  /** True while a `loadMoreHistory` request is in flight; debounces UI triggers. */
  loadingHistory: boolean;
  /**
   * Latest phase tracker snapshot (`<cwd>/.selfclaude/phases.json`).
   * Hydrated lazily on first Phases panel render via `setPhaseTracker`,
   * then kept fresh by `phase-tracker-updated` SSE events. `null` until
   * loaded so the panel can show a loading state.
   */
  phaseTracker: PhaseTrackerFile | null;
  /**
   * Latest Bash macro / script proposals snapshot. Same lazy-hydrate
   * pattern as `phaseTracker`; SSE event `scripts-updated` keeps it
   * fresh once the Scripts panel has done its initial fetch.
   */
  scripts: ScriptsFile | null;
  /**
   * Most recent script proposal that needs operator attention. Set by
   * the `scripts-updated { action: 'proposed' }` SSE event handler;
   * cleared when the operator dismisses the alert dialog (via review,
   * approve, reject, or "later"). The dialog component watches this
   * slot directly — no inference from the `scripts` array, so it
   * fires reliably even when the Scripts panel has never been opened.
   */
  pendingProposalAlert: import('./types').ScriptProposal | null;
  /**
   * Phase 7 sprint 2 — most recent turn-error event for this session.
   * Set on `turn-error` SSE; cleared when the operator dismisses the
   * banner. The banner component reads this directly so the prompt
   * stays scoped to the active session.
   */
  lastTurnError: { code: string; role: string | null; message: string; ts: number } | null;
}

const emptyRoleMetrics = (): RoleMetrics => ({
  totalCostUsd: 0,
  totalTurns: 0,
  lastTurnMs: 0,
  totalDurationMs: 0,
  lastResultAt: null,
});

interface MultiSessionState {
  sessions: Record<string, SessionState>;
  activeId: string | null;

  setMeta(id: string, meta: SessionMeta): void;
  setSnapshot(
    id: string,
    snap: {
      meta: SessionMeta;
      chatLog: ChatLogEntry[];
      pendingQuestions: PendingQuestion[];
      pendingApprovals: PendingApproval[];
      metrics?: {
        sup: RoleMetrics;
        dev: RoleMetrics;
        agents: Record<string, RoleMetrics>;
      };
      hasMoreHistory?: boolean;
    },
  ): void;
  prependHistory(
    id: string,
    entries: ChatLogEntry[],
    hasMoreHistory: boolean,
  ): void;
  setLoadingHistory(id: string, loading: boolean): void;
  /** Hydrate the phase-tracker snapshot from a one-shot fetch. */
  setPhaseTracker(id: string, tracker: PhaseTrackerFile): void;
  /** Hydrate the scripts snapshot from a one-shot fetch. */
  setScripts(id: string, scripts: ScriptsFile): void;
  /** Clear the pending-proposal alert (operator dismissed the modal). */
  clearProposalAlert(id: string): void;
  /** Dismiss the current turn-error banner (operator clicked X). */
  dismissTurnError(id: string): void;
  applyEvent(id: string, event: SessionEvent): void;
  selectTool(id: string, toolUseId: string | null): void;
  remove(id: string): void;
  setActive(id: string | null): void;
}

const empty: SessionState = {
  meta: null,
  chatLog: [],
  pendingQuestion: null,
  pendingApproval: null,
  selectedToolUseId: null,
  busy: false,
  streamingSupTs: null,
  streamingDevTs: null,
  metrics: { sup: emptyRoleMetrics(), dev: emptyRoleMetrics(), agents: {} },
  hasMoreHistory: false,
  loadingHistory: false,
  phaseTracker: null,
  scripts: null,
  pendingProposalAlert: null,
  lastTurnError: null,
};

const HISTORY_LIMIT = 1000;

function append(arr: ChatLogEntry[], entry: ChatLogEntry): ChatLogEntry[] {
  const next = arr.concat(entry);
  return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
}

export const useSessionStore = create<MultiSessionState>((set) => ({
  sessions: {},
  activeId: null,

  setMeta: (id, meta) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: { ...(s.sessions[id] ?? empty), meta },
      },
    })),

  setSnapshot: (id, snap) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: {
          ...(s.sessions[id] ?? empty),
          meta: snap.meta,
          chatLog: snap.chatLog,
          pendingQuestion: snap.pendingQuestions[0] ?? null,
          pendingApproval: snap.pendingApprovals[0] ?? null,
          metrics: snap.metrics ?? {
            sup: emptyRoleMetrics(),
            dev: emptyRoleMetrics(),
            agents: {},
          },
          hasMoreHistory: snap.hasMoreHistory ?? false,
          loadingHistory: false,
        },
      },
    })),

  /**
   * Prepend a window of older entries to a session's chatLog. Used by
   * the lazy-load-on-scroll-near-top flow. Replaces `hasMoreHistory` so
   * the UI knows when there's nothing left to fetch.
   */
  prependHistory: (id, entries, hasMoreHistory) =>
    set((s) => {
      const cur = s.sessions[id];
      if (!cur) return s;
      // Defensive de-dupe by ts (in case of overlap with the live tail).
      const seenTs = new Set(cur.chatLog.map((e) => e.ts));
      const fresh = entries.filter((e) => !seenTs.has(e.ts));
      return {
        sessions: {
          ...s.sessions,
          [id]: {
            ...cur,
            chatLog: [...fresh, ...cur.chatLog],
            hasMoreHistory,
            loadingHistory: false,
          },
        },
      };
    }),

  setLoadingHistory: (id, loading) =>
    set((s) => {
      const cur = s.sessions[id];
      if (!cur) return s;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...cur, loadingHistory: loading },
        },
      };
    }),

  setPhaseTracker: (id, tracker) =>
    set((s) => {
      const cur = s.sessions[id] ?? empty;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...cur, phaseTracker: tracker },
        },
      };
    }),

  setScripts: (id, scripts) =>
    set((s) => {
      const cur = s.sessions[id] ?? empty;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...cur, scripts },
        },
      };
    }),

  clearProposalAlert: (id) =>
    set((s) => {
      const cur = s.sessions[id];
      if (!cur) return s;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...cur, pendingProposalAlert: null },
        },
      };
    }),

  dismissTurnError: (id) =>
    set((s) => {
      const cur = s.sessions[id];
      if (!cur || cur.lastTurnError === null) return s;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...cur, lastTurnError: null },
        },
      };
    }),

  applyEvent: (id, event) =>
    set((s) => {
      const cur = s.sessions[id] ?? empty;
      let next: SessionState = cur;
      const ts = 'ts' in event && typeof event.ts === 'number' ? event.ts : Date.now();
      switch (event.kind) {
        case 'user-message':
          next = { ...cur, chatLog: append(cur.chatLog, { type: 'user-message', text: event.text, ts }) };
          break;
        case 'sup-message': {
          // If the streaming-built bubble is still at the tail, replace it
          // with the final full text rather than duplicating.
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'sup-message' && Math.abs(last.ts - ts) < 60_000) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated], streamingSupTs: null };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'sup-message', text: event.text, ts }),
              streamingSupTs: null,
            };
          }
          break;
        }
        case 'dev-text': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'dev-text' && Math.abs(last.ts - ts) < 60_000) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated], streamingDevTs: null };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'dev-text', text: event.text, ts }),
              streamingDevTs: null,
            };
          }
          break;
        }
        case 'dev-tool-call':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'dev-tool-call',
              id: event.id,
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
              ts,
            }),
            selectedToolUseId: cur.selectedToolUseId ?? event.toolUseId,
          };
          break;
        case 'dev-tool-result':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'dev-tool-result',
              toolUseId: event.toolUseId,
              text: event.text,
              isError: event.isError,
              ts,
            }),
          };
          break;
        case 'sup-tool-call':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'sup-tool-call',
              id: event.id,
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
              ts,
            }),
          };
          break;
        case 'sup-tool-result':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'sup-tool-result',
              toolUseId: event.toolUseId,
              text: event.text,
              isError: event.isError,
              ts,
            }),
          };
          break;
        case 'task-marker':
          next = { ...cur, chatLog: append(cur.chatLog, { type: 'task-marker', summary: event.summary, ts }) };
          break;
        case 'phase-doc-written':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, { type: 'phase-doc-written', filename: event.filename, ts }),
          };
          break;
        case 'question':
          next = { ...cur, pendingQuestion: event.question };
          break;
        case 'question-resolved':
          next = { ...cur, pendingQuestion: null };
          break;
        case 'approval':
          next = { ...cur, pendingApproval: event.approval };
          break;
        case 'approval-resolved':
          next = { ...cur, pendingApproval: null };
          break;
        case 'turn-busy':
          // When a turn ends, also clear streaming markers in case the final
          // sup-message/dev-text never arrived (defensive).
          next = event.busy
            ? { ...cur, busy: true }
            : { ...cur, busy: false, streamingSupTs: null, streamingDevTs: null };
          break;
        case 'state-changed':
          if (cur.meta) {
            next = {
              ...cur,
              meta: {
                ...cur.meta,
                phase: event.state.phase ?? cur.meta.phase,
                supActive: event.state.tag === 'sup-running',
                devActive: event.state.tag === 'dev-running',
              },
            };
          }
          break;
        case 'user-note-dev':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, { type: 'user-note-dev', text: event.text, ts }),
          };
          break;
        case 'user-message-dev':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, { type: 'user-message-dev', text: event.text, ts }),
          };
          break;
        case 'sup-thinking-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'sup-thinking') {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'sup-thinking',
                text: event.delta,
                ts,
              }),
            };
          }
          break;
        }
        case 'dev-thinking-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'dev-thinking') {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'dev-thinking',
                text: event.delta,
                ts,
              }),
            };
          }
          break;
        }
        case 'sup-thinking': {
          // Final thinking — replace the last accumulating thinking bubble
          // if it's still at the tail; otherwise append a fresh entry.
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'sup-thinking' && Math.abs(last.ts - ts) < 60_000) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'sup-thinking', text: event.text, ts }),
            };
          }
          break;
        }
        case 'dev-thinking': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'dev-thinking' && Math.abs(last.ts - ts) < 60_000) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'dev-thinking', text: event.text, ts }),
            };
          }
          break;
        }
        case 'sup-message-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'sup-message') {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = {
              ...cur,
              chatLog: [...cur.chatLog.slice(0, -1), updated],
              streamingSupTs: last.ts,
            };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'sup-message', text: event.delta, ts }),
              streamingSupTs: ts,
            };
          }
          break;
        }
        case 'dev-text-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'dev-text') {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = {
              ...cur,
              chatLog: [...cur.chatLog.slice(0, -1), updated],
              streamingDevTs: last.ts,
            };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, { type: 'dev-text', text: event.delta, ts }),
              streamingDevTs: ts,
            };
          }
          break;
        }
        case 'role-metrics':
          // Route built-ins to their dedicated slot; everyone else
          // lands in the per-agent map keyed by name.
          if (event.role === 'supervisor') {
            next = {
              ...cur,
              metrics: { ...cur.metrics, sup: event.metrics },
            };
          } else if (event.role === 'developer') {
            next = {
              ...cur,
              metrics: { ...cur.metrics, dev: event.metrics },
            };
          } else {
            next = {
              ...cur,
              metrics: {
                ...cur.metrics,
                agents: { ...cur.metrics.agents, [event.role]: event.metrics },
              },
            };
          }
          break;
        case 'wakeup-scheduled':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'wakeup-scheduled',
              wakeupId: event.wakeupId,
              role: event.role,
              fireAt: event.fireAt,
              prompt: event.prompt,
              reason: event.reason,
              ts,
            }),
          };
          break;
        case 'wakeup-fired':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'wakeup-fired',
              wakeupId: event.wakeupId,
              role: event.role,
              ts,
            }),
          };
          break;
        case 'wakeup-cancelled':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'wakeup-cancelled',
              wakeupId: event.wakeupId,
              role: event.role,
              reason: event.reason,
              ts,
            }),
          };
          break;
        case 'agent-text': {
          // Same delta-replace logic as `dev-text` but keyed by the
          // generic `agent-text` entry so multiple specialists don't
          // collide when streaming concurrently.
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (
            last?.type === 'agent-text' &&
            last.agent === event.agent &&
            Math.abs(last.ts - ts) < 60_000
          ) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'agent-text',
                agent: event.agent,
                text: event.text,
                ts,
              }),
            };
          }
          break;
        }
        case 'agent-text-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'agent-text' && last.agent === event.agent) {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'agent-text',
                agent: event.agent,
                text: event.delta,
                ts,
              }),
            };
          }
          break;
        }
        case 'agent-thinking': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (
            last?.type === 'agent-thinking' &&
            last.agent === event.agent &&
            Math.abs(last.ts - ts) < 60_000
          ) {
            const updated: ChatLogEntry = { ...last, text: event.text };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'agent-thinking',
                agent: event.agent,
                text: event.text,
                ts,
              }),
            };
          }
          break;
        }
        case 'agent-thinking-delta': {
          const last = cur.chatLog[cur.chatLog.length - 1];
          if (last?.type === 'agent-thinking' && last.agent === event.agent) {
            const updated: ChatLogEntry = { ...last, text: last.text + event.delta };
            next = { ...cur, chatLog: [...cur.chatLog.slice(0, -1), updated] };
          } else {
            next = {
              ...cur,
              chatLog: append(cur.chatLog, {
                type: 'agent-thinking',
                agent: event.agent,
                text: event.delta,
                ts,
              }),
            };
          }
          break;
        }
        case 'agent-tool-call':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'agent-tool-call',
              agent: event.agent,
              id: event.id,
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
              ts,
            }),
          };
          break;
        case 'agent-tool-result':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'agent-tool-result',
              agent: event.agent,
              toolUseId: event.toolUseId,
              text: event.text,
              isError: event.isError,
              ts,
            }),
          };
          break;
        case 'agent-summoned':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'agent-summoned',
              agent: event.agent,
              ts,
            }),
          };
          break;
        case 'agent-dismissed':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'agent-dismissed',
              agent: event.agent,
              ts,
            }),
          };
          break;
        case 'verdict':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'verdict',
              id: event.id,
              text: event.text,
              ts,
            }),
          };
          break;
        case 'room-message':
          next = {
            ...cur,
            chatLog: append(cur.chatLog, {
              type: 'room-message',
              agent: event.agent,
              text: event.text,
              ts,
            }),
          };
          break;
        case 'phase-tracker-updated':
          // Server inlines both the post-mutation snapshot AND the
          // matching chat-log entry; we apply the snapshot to the
          // tracker slot AND (when present) push the log entry into
          // chatLog so the Audit Log panel sees the mutation live
          // without paginating. `logEntry` is null on `external-edit`
          // (file changed outside the MCP path) — snapshot-only update
          // in that case.
          next = {
            ...cur,
            phaseTracker: event.file,
            chatLog: event.logEntry ? append(cur.chatLog, event.logEntry) : cur.chatLog,
          };
          break;
        case 'scripts-updated':
          // Pop the alert dialog when sup files a new proposal — find
          // the proposal in the just-arrived snapshot by slug. For
          // approve/reject events we leave any existing alert alone
          // (the dialog clears itself on operator action).
          if (event.action === 'proposed') {
            const newProposal = event.file.scripts.find(
              (s) => s.slug === event.slug,
            );
            next = {
              ...cur,
              scripts: event.file,
              pendingProposalAlert: newProposal ?? cur.pendingProposalAlert,
            };
          } else {
            next = { ...cur, scripts: event.file };
          }
          break;
        case 'iteration-end':
          // No state mutation needed.
          break;
        case 'turn-error':
          // Phase 7 sprint 2 — persist on the session so the
          // banner can render. Cleared via `dismissTurnError`.
          next = {
            ...cur,
            lastTurnError: {
              code: event.code,
              role: event.role,
              message: event.message,
              ts: Date.now(),
            },
          };
          break;
      }
      return { sessions: { ...s.sessions, [id]: next } };
    }),

  selectTool: (id, toolUseId) =>
    set((s) => {
      const cur = s.sessions[id];
      if (!cur) return s;
      return {
        sessions: { ...s.sessions, [id]: { ...cur, selectedToolUseId: toolUseId } },
      };
    }),

  remove: (id) =>
    set((s) => {
      const next = { ...s.sessions };
      delete next[id];
      return { sessions: next, activeId: s.activeId === id ? null : s.activeId };
    }),

  setActive: (id) => set({ activeId: id }),
}));
