'use client';

import { create } from 'zustand';
import type {
  ChatLogEntry,
  PendingApproval,
  PendingQuestion,
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
}

interface MultiSessionState {
  sessions: Record<string, SessionState>;
  activeId: string | null;

  setMeta(id: string, meta: SessionMeta): void;
  setSnapshot(id: string, snap: { meta: SessionMeta; chatLog: ChatLogEntry[]; pendingQuestions: PendingQuestion[]; pendingApprovals: PendingApproval[] }): void;
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
        },
      },
    })),

  applyEvent: (id, event) =>
    set((s) => {
      const cur = s.sessions[id] ?? empty;
      let next: SessionState = cur;
      const ts = 'ts' in event && typeof event.ts === 'number' ? event.ts : Date.now();
      switch (event.kind) {
        case 'user-message':
          next = { ...cur, chatLog: append(cur.chatLog, { type: 'user-message', text: event.text, ts }) };
          break;
        case 'sup-message':
          next = { ...cur, chatLog: append(cur.chatLog, { type: 'sup-message', text: event.text, ts }) };
          break;
        case 'dev-text':
          next = { ...cur, chatLog: append(cur.chatLog, { type: 'dev-text', text: event.text, ts }) };
          break;
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
          next = { ...cur, busy: event.busy };
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
        case 'iteration-end':
        case 'error':
          // No-op for state; could surface via toast in UI.
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
