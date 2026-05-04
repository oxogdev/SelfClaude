import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let logFile: string | null = null;
let minLevel: LogLevel = 'info';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function configureLogFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  logFile = path;
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data ?? {}) });
  if (logFile) {
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch {
      // never let logging crash the orchestrator
    }
  }
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
  }
}
