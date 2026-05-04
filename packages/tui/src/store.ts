import { randomUUID } from 'node:crypto';
import { create } from 'zustand';
import type { FsmState } from '@selfclaude/core';

export type ChatLineKind = 'user' | 'supervisor' | 'system' | 'task-tag' | 'phase-doc';

export type ChatLine = {
  kind: ChatLineKind;
  text: string;
  ts: number;
};

export type DevEventKind =
  | 'turn-marker'
  | 'task-marker'
  | 'tool'
  | 'tool-result'
  | 'text'
  | 'system';

export interface DevEvent {
  id: string;
  ts: number;
  turnIndex: number;
  kind: DevEventKind;
  /** Single-line label rendered in the developer timeline. */
  summary: string;
  // tool-specific (kind === 'tool')
  toolUseId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  // tool-result-specific (kind === 'tool' once paired, holds the result back-reference)
  toolResultText?: string;
  isError?: boolean;
}

export type NewDevEventInput =
  | {
      kind: Exclude<DevEventKind, 'tool'>;
      summary: string;
    }
  | {
      kind: 'tool';
      summary: string;
      toolUseId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
    };

export type PendingQuestion = {
  id: string;
  text: string;
  options?: string[];
};

export type PendingApproval = {
  id: string;
  action: string;
  reason: string;
};

export type FocusedPane = 'input' | 'dev';

const HISTORY_LIMIT = 500;

export interface TuiState {
  fsmState: FsmState;
  phase: string;
  supervisorActive: boolean;
  developerActive: boolean;
  telegramConnected: boolean;
  supervisorChat: ChatLine[];
  developerEvents: DevEvent[];
  pendingQuestion: PendingQuestion | null;
  pendingApproval: PendingApproval | null;
  selectedDevEventId: string | null;
  /** Auto-follow when true (selection floats to the latest event); user-driven selection clears it. */
  autoFollow: boolean;
  focusedPane: FocusedPane;
  terminalSize: { cols: number; rows: number };
  currentTurnIndex: number;

  appendSupervisor: (line: ChatLine) => void;
  appendDeveloper: (input: NewDevEventInput) => string;
  updateDeveloperEvent: (id: string, patch: Partial<DevEvent>) => void;
  selectDevEvent: (id: string | null, opts?: { autoFollow?: boolean }) => void;
  selectPrevDevEvent: () => void;
  selectNextDevEvent: () => void;
  selectFirstDevEvent: () => void;
  selectLastDevEvent: () => void;
  enableAutoFollow: () => void;
  setFocus: (pane: FocusedPane) => void;
  setTerminalSize: (size: { cols: number; rows: number }) => void;
  bumpTurn: () => number;
  setFsmState: (s: FsmState) => void;
  setPhase: (p: string) => void;
  setSupervisorActive: (b: boolean) => void;
  setDeveloperActive: (b: boolean) => void;
  setTelegramConnected: (b: boolean) => void;
  setQuestion: (q: PendingQuestion | null) => void;
  setApproval: (a: PendingApproval | null) => void;
}

export const useTuiStore = create<TuiState>((set, get) => ({
  fsmState: { tag: 'idle', phase: 'discovery' },
  phase: 'discovery',
  supervisorActive: false,
  developerActive: false,
  telegramConnected: false,
  supervisorChat: [],
  developerEvents: [],
  pendingQuestion: null,
  pendingApproval: null,
  selectedDevEventId: null,
  autoFollow: true,
  focusedPane: 'input',
  terminalSize: { cols: 100, rows: 30 },
  currentTurnIndex: 0,

  appendSupervisor: (line) =>
    set((s) => ({ supervisorChat: [...s.supervisorChat, line].slice(-HISTORY_LIMIT) })),

  appendDeveloper: (input) => {
    const id = randomUUID();
    const turnIndex = get().currentTurnIndex;
    const ts = Date.now();
    set((s) => {
      const evt: DevEvent =
        input.kind === 'tool'
          ? {
              id,
              ts,
              turnIndex,
              kind: 'tool',
              summary: input.summary,
              toolUseId: input.toolUseId,
              toolName: input.toolName,
              toolInput: input.toolInput,
            }
          : {
              id,
              ts,
              turnIndex,
              kind: input.kind,
              summary: input.summary,
            };
      const next = [...s.developerEvents, evt].slice(-HISTORY_LIMIT);
      // auto-follow: if user has not selected a specific event, keep selection on
      // the latest, so the detail pane updates as work happens.
      const nextSelected = s.autoFollow ? id : s.selectedDevEventId;
      return { developerEvents: next, selectedDevEventId: nextSelected };
    });
    return id;
  },

  updateDeveloperEvent: (id, patch) =>
    set((s) => ({
      developerEvents: s.developerEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  selectDevEvent: (id, opts) =>
    set(() => ({
      selectedDevEventId: id,
      autoFollow: opts?.autoFollow ?? id === null,
    })),

  selectPrevDevEvent: () =>
    set((s) => {
      const events = s.developerEvents;
      if (events.length === 0) return s;
      const currIdx = s.selectedDevEventId
        ? events.findIndex((e) => e.id === s.selectedDevEventId)
        : events.length - 1;
      const prevIdx = Math.max(0, currIdx - 1);
      const target = events[prevIdx];
      if (!target) return s;
      return { selectedDevEventId: target.id, autoFollow: false };
    }),

  selectNextDevEvent: () =>
    set((s) => {
      const events = s.developerEvents;
      if (events.length === 0) return s;
      const currIdx = s.selectedDevEventId
        ? events.findIndex((e) => e.id === s.selectedDevEventId)
        : events.length - 1;
      const nextIdx = Math.min(events.length - 1, currIdx + 1);
      const target = events[nextIdx];
      if (!target) return s;
      const isLast = nextIdx === events.length - 1;
      return { selectedDevEventId: target.id, autoFollow: isLast };
    }),

  selectFirstDevEvent: () =>
    set((s) => {
      const target = s.developerEvents[0];
      if (!target) return s;
      return { selectedDevEventId: target.id, autoFollow: false };
    }),

  selectLastDevEvent: () =>
    set((s) => {
      const target = s.developerEvents[s.developerEvents.length - 1];
      if (!target) return s;
      return { selectedDevEventId: target.id, autoFollow: true };
    }),

  enableAutoFollow: () =>
    set((s) => {
      const target = s.developerEvents[s.developerEvents.length - 1];
      return {
        selectedDevEventId: target?.id ?? null,
        autoFollow: true,
      };
    }),

  setFocus: (pane) => set({ focusedPane: pane }),
  setTerminalSize: (size) => set({ terminalSize: size }),
  bumpTurn: () => {
    const next = get().currentTurnIndex + 1;
    set({ currentTurnIndex: next });
    return next;
  },

  setFsmState: (fsmState) => set({ fsmState }),
  setPhase: (phase) => set({ phase }),
  setSupervisorActive: (b) => set({ supervisorActive: b }),
  setDeveloperActive: (b) => set({ developerActive: b }),
  setTelegramConnected: (b) => set({ telegramConnected: b }),
  setQuestion: (q) => set({ pendingQuestion: q }),
  setApproval: (a) => set({ pendingApproval: a }),
}));
