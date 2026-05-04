#!/usr/bin/env node
// Global launcher for the `selfclaude` CLI.
//
// Resolves to `node_modules/.bin/tsx` (devDependency) and runs the TypeScript
// entrypoint directly — no build step required. Symlink-aware so `pnpm link
// --global` works.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT = realpathSync(fileURLToPath(import.meta.url));
const HERE = dirname(SCRIPT);
const REPO_ROOT = resolve(HERE, '..');
const TSX = resolve(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const TSCONFIG = resolve(REPO_ROOT, 'tsconfig.json');
const ENTRY = resolve(HERE, 'selfclaude.ts');

// Pass --tsconfig explicitly so JSX (jsx: react-jsx) resolves correctly even
// when invoked from a directory that has no tsconfig.json of its own.
const child = spawn(TSX, ['--tsconfig', TSCONFIG, ENTRY, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
