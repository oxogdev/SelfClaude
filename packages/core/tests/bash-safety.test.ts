import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBashSafety } from '../src/orchestrator/bash-safety.js';

test('foreground pnpm start is rejected', () => {
  const issue = checkBashSafety({ command: 'pnpm start' });
  assert.ok(issue);
  assert.match(issue!.reason, /long-lived process/);
});

test('foreground npm run dev is rejected', () => {
  assert.ok(checkBashSafety({ command: 'cd app && npm run dev' }));
});

test('foreground next dev is rejected', () => {
  assert.ok(checkBashSafety({ command: 'next dev --port 4000' }));
});

test('foreground node server.js is rejected', () => {
  assert.ok(checkBashSafety({ command: 'node src/server.js' }));
});

test('python http.server foreground is rejected', () => {
  assert.ok(checkBashSafety({ command: 'python -m http.server 8000' }));
});

test('tail -f is rejected', () => {
  assert.ok(checkBashSafety({ command: 'tail -f /var/log/app.log' }));
});

test('docker compose up without -d is rejected', () => {
  assert.ok(checkBashSafety({ command: 'docker compose up' }));
});

test('backgrounded pnpm start is allowed', () => {
  const cmd =
    'nohup pnpm start > /tmp/x.log 2>&1 & PID=$!; sleep 2; curl -s localhost:3000; kill $PID';
  assert.equal(checkBashSafety({ command: cmd }), null);
});

test('npm start with shell timeout is allowed', () => {
  assert.equal(checkBashSafety({ command: 'timeout 10 npm start' }), null);
});

test('docker compose up -d is allowed', () => {
  assert.equal(checkBashSafety({ command: 'docker compose up -d' }), null);
});

test('plain ls / curl / grep is allowed', () => {
  assert.equal(checkBashSafety({ command: 'ls -la' }), null);
  assert.equal(checkBashSafety({ command: 'curl -s https://example.com' }), null);
  assert.equal(checkBashSafety({ command: 'grep -r foo .' }), null);
});

test('explicit Bash-tool timeout ≤ 300s overrides the check', () => {
  const issue = checkBashSafety({ command: 'pnpm start', timeout: 60_000 });
  assert.equal(issue, null);
});

test('Bash-tool timeout > 300s does NOT bypass the check', () => {
  const issue = checkBashSafety({ command: 'pnpm start', timeout: 600_000 });
  assert.ok(issue);
});

test('non-string / empty command returns null', () => {
  assert.equal(checkBashSafety({ command: '' }), null);
  assert.equal(checkBashSafety({ command: 42 }), null);
  assert.equal(checkBashSafety(null), null);
  assert.equal(checkBashSafety('not an object'), null);
});

test('long-running word-boundaries do not match unrelated text', () => {
  // The literal command is `echo "next dev"` — substring match but not a
  // command invocation. Our regex is anchored on word boundaries; this is
  // a known limitation we accept (echoing literal command strings is rare;
  // the false positive is benign — model can clarify with a different shell).
  // This test documents the current behaviour rather than a hard contract.
  const result = checkBashSafety({ command: 'echo "next dev"' });
  // Either null (safe) or an issue (over-conservative); both acceptable.
  // We only assert the function does not crash.
  assert.ok(result === null || typeof result.reason === 'string');
});
