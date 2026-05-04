import { create } from 'zustand';
import type { FsmState } from '../orchestrator/state-machine.js';

export type ChatLine = {
  kind: 'user' | 'supervisor' | 'system';
  text: string;
  ts: number;
};

export type DevEvent = {
  kind: 'text' | 'tool' | 'tool-result' | 'system';
  payload: string;
  ts: number;
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

const HISTORY_LIMIT = 200;

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

  appendSupervisor: (line: ChatLine) => void;
  appendDeveloper: (evt: DevEvent) => void;
  setFsmState: (s: FsmState) => void;
  setPhase: (p: string) => void;
  setSupervisorActive: (b: boolean) => void;
  setDeveloperActive: (b: boolean) => void;
  setTelegramConnected: (b: boolean) => void;
  setQuestion: (q: PendingQuestion | null) => void;
  setApproval: (a: PendingApproval | null) => void;
}

export const useTuiStore = create<TuiState>((set) => ({
  fsmState: { tag: 'idle', phase: 'discovery' },
  phase: 'discovery',
  supervisorActive: false,
  developerActive: false,
  telegramConnected: false,
  supervisorChat: [],
  developerEvents: [],
  pendingQuestion: null,
  pendingApproval: null,

  appendSupervisor: (line) =>
    set((s) => ({ supervisorChat: [...s.supervisorChat, line].slice(-HISTORY_LIMIT) })),
  appendDeveloper: (evt) =>
    set((s) => ({ developerEvents: [...s.developerEvents, evt].slice(-HISTORY_LIMIT) })),
  setFsmState: (fsmState) => set({ fsmState }),
  setPhase: (phase) => set({ phase }),
  setSupervisorActive: (b) => set({ supervisorActive: b }),
  setDeveloperActive: (b) => set({ developerActive: b }),
  setTelegramConnected: (b) => set({ telegramConnected: b }),
  setQuestion: (q) => set({ pendingQuestion: q }),
  setApproval: (a) => set({ pendingApproval: a }),
}));
