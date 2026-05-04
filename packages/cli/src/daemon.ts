import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const RUN_DIR = join(homedir(), '.selfclaude');
export const PID_FILE = join(RUN_DIR, 'run.pid');
export const LOG_FILE = join(RUN_DIR, 'run.log');

function ensureRunDir(): void {
  if (!existsSync(RUN_DIR)) mkdirSync(RUN_DIR, { recursive: true });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf8').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearStalePid(): number | null {
  const pid = readPid();
  if (pid === null) return null;
  if (isAlive(pid)) return pid;
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  return null;
}

const WEB_UI_URL = (port: number) => `http://127.0.0.1:${port}/`;

export interface DaemonStartOptions {
  apiPort?: number;
  webPort?: number;
  openBrowser?: boolean;
}

export async function daemonStart(opts: DaemonStartOptions = {}): Promise<void> {
  ensureRunDir();
  const apiPort = opts.apiPort ?? 7423;
  const webPort = opts.webPort ?? 3000;
  const openBrowser = opts.openBrowser !== false;

  const existing = clearStalePid();
  if (existing) {
    console.log(`SelfClaude already running (pid ${existing}).`);
    console.log(`  Web UI: ${WEB_UI_URL(webPort)}`);
    console.log('  Stop:   selfclaude stop');
    if (openBrowser) {
      try {
        spawn('open', [WEB_UI_URL(webPort)], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        /* best effort */
      }
    }
    return;
  }

  const out = openSync(LOG_FILE, 'a');
  const err = openSync(LOG_FILE, 'a');

  // Re-spawn ourselves in --foreground mode, fully detached.
  const child = spawn(
    'selfclaude',
    [
      'start',
      '--foreground',
      '--no-open',
      '--port',
      String(apiPort),
      '--web-port',
      String(webPort),
    ],
    {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, SELFCLAUDE_DAEMON: '1' },
    },
  );
  child.unref();

  if (!child.pid) {
    console.error('Failed to spawn the daemon process.');
    process.exit(1);
  }
  writeFileSync(PID_FILE, String(child.pid));

  // Wait briefly to confirm the child is still alive (catches immediate
  // crashes from port conflicts, missing deps, etc).
  await wait(1500);
  if (!isAlive(child.pid)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    console.error('SelfClaude crashed during startup.');
    console.error(`  Logs: ${LOG_FILE}`);
    process.exit(1);
  }

  if (openBrowser) {
    try {
      spawn('open', [WEB_UI_URL(webPort)], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* best effort */
    }
  }

  console.log(`✓ SelfClaude started (pid ${child.pid})`);
  console.log(`  Web UI: ${WEB_UI_URL(webPort)}`);
  console.log('  Logs:   selfclaude logs');
  console.log('  Stop:   selfclaude stop');
}

export async function daemonStop(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    console.log('SelfClaude is not running.');
    return;
  }
  if (!isAlive(pid)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    console.log(`Stale PID file (pid ${pid}) cleaned up.`);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    console.error(`Failed to signal pid ${pid}: ${(e as Error).message}`);
  }

  // Up to 5 s to exit gracefully.
  for (let i = 0; i < 50; i++) {
    if (!isAlive(pid)) {
      try {
        unlinkSync(PID_FILE);
      } catch {
        /* ignore */
      }
      console.log(`✓ SelfClaude stopped (pid ${pid})`);
      return;
    }
    await wait(100);
  }

  console.warn(`pid ${pid} did not exit; sending SIGKILL`);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  await wait(200);
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  console.log(`✓ SelfClaude killed (pid ${pid})`);
}

export function daemonStatus(): void {
  const pid = readPid();
  if (pid === null) {
    console.log('SelfClaude is not running.');
    return;
  }
  if (!isAlive(pid)) {
    console.log(`Stale PID file (pid ${pid}). Run \`selfclaude stop\` to clean up.`);
    return;
  }
  console.log(`✓ SelfClaude running (pid ${pid})`);
  console.log('  Web UI: http://127.0.0.1:3000/');
  console.log('  Logs:   selfclaude logs');
  console.log('  Stop:   selfclaude stop');
}

export function daemonLogs(opts: { follow?: boolean; lines?: number } = {}): void {
  if (!existsSync(LOG_FILE)) {
    console.log('No log file yet.');
    return;
  }
  const lines = opts.lines ?? 100;
  const args = opts.follow ? ['-n', String(lines), '-f', LOG_FILE] : ['-n', String(lines), LOG_FILE];
  const child = spawn('tail', args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
