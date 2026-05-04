import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../src/orchestrator/policy.js';

test('Bash rm -rf is gated', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'rm -rf /tmp/foo' } });
  assert.equal(r.action, 'require-approval');
  assert.match(r.reason ?? '', /rm/);
});

test('Bash rm without -rf is allowed', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'rm /tmp/foo.txt' } });
  assert.equal(r.action, 'allow');
});

test('git push --force is gated', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'git push --force origin main' } });
  assert.equal(r.action, 'require-approval');
  assert.match(r.reason ?? '', /force/);
});

test('git push --force-with-lease is allowed (safer variant)', () => {
  const r = evaluatePolicy({
    toolName: 'Bash',
    toolInput: { command: 'git push --force-with-lease origin main' },
  });
  assert.equal(r.action, 'allow');
});

test('git push without --force is allowed', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'git push origin main' } });
  assert.equal(r.action, 'allow');
});

test('git reset --hard is gated', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'git reset --hard HEAD~1' } });
  assert.equal(r.action, 'require-approval');
});

test('docker compose down -v is gated; plain down is allowed', () => {
  const denied = evaluatePolicy({
    toolName: 'Bash',
    toolInput: { command: 'docker compose down -v' },
  });
  assert.equal(denied.action, 'require-approval');
  const allowed = evaluatePolicy({
    toolName: 'Bash',
    toolInput: { command: 'docker compose down' },
  });
  assert.equal(allowed.action, 'allow');
});

test('docker volume rm and docker system prune are gated', () => {
  assert.equal(
    evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'docker volume rm db_data' } }).action,
    'require-approval',
  );
  assert.equal(
    evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'docker system prune -f' } }).action,
    'require-approval',
  );
});

test('SQL drop / truncate / unguarded delete are gated', () => {
  assert.equal(
    evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'psql -c "drop table users"' } }).action,
    'require-approval',
  );
  assert.equal(
    evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'psql -c "truncate table sessions"' } }).action,
    'require-approval',
  );
  assert.equal(
    evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'psql -c "delete from sessions"' } }).action,
    'require-approval',
  );
});

test('kill -9 is gated', () => {
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: 'kill -9 12345' } });
  assert.equal(r.action, 'require-approval');
});

test('Write to .env is gated', () => {
  const r = evaluatePolicy({ toolName: 'Write', toolInput: { file_path: '/proj/.env' } });
  assert.equal(r.action, 'require-approval');
});

test('Write to .env.local is gated', () => {
  const r = evaluatePolicy({ toolName: 'Write', toolInput: { file_path: '/proj/.env.local' } });
  assert.equal(r.action, 'require-approval');
});

test('Write to ordinary file is allowed', () => {
  const r = evaluatePolicy({ toolName: 'Write', toolInput: { file_path: '/proj/src/index.ts' } });
  assert.equal(r.action, 'allow');
});

test('Edit to id_rsa is gated', () => {
  const r = evaluatePolicy({ toolName: 'Edit', toolInput: { file_path: '/home/u/.ssh/id_rsa' } });
  assert.equal(r.action, 'require-approval');
});

test('Read tool is never gated', () => {
  const r = evaluatePolicy({ toolName: 'Read', toolInput: { file_path: '/anywhere/.env' } });
  assert.equal(r.action, 'allow');
});

test('summary is truncated for very long bash commands', () => {
  const cmd = `rm -rf ${'/very/long/path/'.repeat(20)}`;
  const r = evaluatePolicy({ toolName: 'Bash', toolInput: { command: cmd } });
  assert.equal(r.action, 'require-approval');
  assert.ok((r.summary ?? '').length <= 120);
});
