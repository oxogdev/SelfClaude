import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `start` until a `pnpm-workspace.yaml` (monorepo root) or `.env`
 * is found. Falls back to assuming the canonical packages/core/src/lib depth
 * if neither marker is present.
 */
export function findRepoRoot(start: string = HERE): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, '.env'))) return dir;
    if (existsSync(join(dir, '.env.example'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      // packages/core/src/lib → four levels up to reach monorepo root.
      return resolve(start, '..', '..', '..', '..');
    }
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();
export const ENV_PATH = resolve(REPO_ROOT, '.env');
export const ENV_EXAMPLE_PATH = resolve(REPO_ROOT, '.env.example');

// Always load from the SelfClaude repo root so the env is consistent
// regardless of cwd (orchestrator runs in the user's project dir).
// `.env` wins; `.env.example` is read as a fallback so users who keep their
// dev token in `.env.example` don't have to duplicate it.
dotenvConfig({ path: [ENV_PATH, ENV_EXAMPLE_PATH] });

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}

export function hasTelegram(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/**
 * Idempotently set a single KEY=value pair in a dotenv file. Updates an
 * existing line in place if the key is already present; otherwise appends.
 * Other lines (including quoted values, comments, empty lines) are preserved.
 */
export async function setEnvVar(envPath: string, key: string, value: string): Promise<void> {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    throw new Error(`invalid env key: ${key}`);
  }
  let content = '';
  try {
    content = await readFile(envPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const hadTrailingNewline = content === '' || content.endsWith('\n');
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n');
  const re = new RegExp(`^${key}\\s*=`);
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) {
      lines[i] = `${key}=${value}`;
      updated = true;
      break;
    }
  }
  if (!updated) lines.push(`${key}=${value}`);
  await writeFile(envPath, lines.join('\n') + (hadTrailingNewline ? '\n' : ''));
}
