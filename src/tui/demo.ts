import { useTuiStore } from './store.js';

type StoreActions = ReturnType<typeof useTuiStore.getState>;

interface DemoStep {
  delayMs: number;
  apply: (s: StoreActions) => void;
}

const STEPS: DemoStep[] = [
  {
    delayMs: 300,
    apply: (s) => {
      s.setPhase('discovery');
      s.setSupervisorActive(true);
      s.appendSupervisor({
        kind: 'system',
        text: 'Supervisor online — discovery starting.',
        ts: Date.now(),
      });
    },
  },
  {
    delayMs: 1200,
    apply: (s) =>
      s.appendSupervisor({
        kind: 'supervisor',
        text: 'Bu projede ne yapmak istediğini birkaç cümle anlatır mısın?',
        ts: Date.now(),
      }),
  },
  {
    delayMs: 2400,
    apply: (s) =>
      s.appendSupervisor({
        kind: 'user',
        text: 'Bir url shortener; postgres + node.',
        ts: Date.now(),
      }),
  },
  {
    delayMs: 3200,
    apply: (s) => {
      s.setSupervisorActive(false);
      s.setDeveloperActive(true);
      s.setPhase('phase-loop');
      s.appendDeveloper({ kind: 'system', payload: 'Developer turn started.', ts: Date.now() });
    },
  },
  {
    delayMs: 3700,
    apply: (s) =>
      s.appendDeveloper({ kind: 'tool', payload: 'Read package.json', ts: Date.now() }),
  },
  {
    delayMs: 4200,
    apply: (s) => s.appendDeveloper({ kind: 'tool-result', payload: '46 lines', ts: Date.now() }),
  },
  {
    delayMs: 4800,
    apply: (s) =>
      s.appendDeveloper({ kind: 'tool', payload: 'Write src/server.ts', ts: Date.now() }),
  },
  {
    delayMs: 5500,
    apply: (s) =>
      s.appendDeveloper({
        kind: 'text',
        payload: 'Bootstrapped fastify server, routes scaffolded.',
        ts: Date.now(),
      }),
  },
  {
    delayMs: 6500,
    apply: (s) => {
      s.setDeveloperActive(false);
      s.setSupervisorActive(true);
      s.appendSupervisor({
        kind: 'supervisor',
        text: 'Schema seçimini onayla — uuid mi, kısaltma mı?',
        ts: Date.now(),
      });
      s.setQuestion({
        id: 'demo-q-1',
        text: 'Schema seçimi: uuid mi, kısaltma mı?',
        options: ['uuid', 'short-code'],
      });
    },
  },
];

export function runDemo(): void {
  let cumulative = 0;
  for (const step of STEPS) {
    cumulative += step.delayMs;
    setTimeout(() => step.apply(useTuiStore.getState()), cumulative);
  }
}
