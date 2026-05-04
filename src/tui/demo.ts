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
        text: 'supervisor online — discovery starting',
        ts: Date.now(),
      });
    },
  },
  {
    delayMs: 1100,
    apply: (s) =>
      s.appendSupervisor({
        kind: 'supervisor',
        text: 'Bu projede ne yapmak istediğini birkaç cümle anlatır mısın?',
        ts: Date.now(),
      }),
  },
  {
    delayMs: 2300,
    apply: (s) =>
      s.appendSupervisor({
        kind: 'user',
        text: 'Bir url shortener; postgres + node, MVP.',
        ts: Date.now(),
      }),
  },
  {
    delayMs: 3100,
    apply: (s) => {
      s.setSupervisorActive(false);
      s.setDeveloperActive(true);
      s.setPhase('phase-loop');
      const turn = s.bumpTurn();
      s.appendDeveloper({ kind: 'turn-marker', summary: `── turn ${turn} ──` });
      s.appendDeveloper({ kind: 'task-marker', summary: 'sup→dev: scaffold fastify routes' });
      s.appendSupervisor({
        kind: 'task-tag',
        text: 'scaffold fastify routes for /shorten and /:code',
        ts: Date.now(),
      });
    },
  },
  {
    delayMs: 3600,
    apply: (s) => {
      const id = s.appendDeveloper({
        kind: 'tool',
        summary: 'Read: package.json',
        toolUseId: 'tu_demo_1',
        toolName: 'Read',
        toolInput: { file_path: '/proj/package.json' },
      });
      // pretend tool result a moment later
      setTimeout(() => {
        s.updateDeveloperEvent(id, {
          toolResultText: '46 lines\n{\n  "name": "url-shortener",\n  "type": "module"\n}',
          isError: false,
        });
      }, 400);
    },
  },
  {
    delayMs: 4400,
    apply: (s) => {
      const id = s.appendDeveloper({
        kind: 'tool',
        summary: 'Write: src/server.ts',
        toolUseId: 'tu_demo_2',
        toolName: 'Write',
        toolInput: {
          file_path: '/proj/src/server.ts',
          content: 'import Fastify from "fastify";\nconst app = Fastify();\n…',
        },
      });
      setTimeout(() => {
        s.updateDeveloperEvent(id, {
          toolResultText: 'wrote 38 lines',
          isError: false,
        });
      }, 350);
    },
  },
  {
    delayMs: 5300,
    apply: (s) =>
      s.appendDeveloper({
        kind: 'text',
        summary: 'Bootstrapped fastify server, /shorten and /:code routes scaffolded.',
      }),
  },
  {
    delayMs: 6200,
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
