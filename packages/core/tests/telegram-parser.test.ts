import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApprovalReply } from '../src/telegram/parser.js';

test('parseApprovalReply: yes/y/ok/allow/onay/evet → allow', () => {
  for (const t of ['yes', 'y', 'YES', 'ok', 'okay', 'allow', 'Onay', 'evet', 'tamam', 'approve', 'Approved']) {
    assert.equal(parseApprovalReply(t), 'allow', `expected allow for "${t}"`);
  }
});

test('parseApprovalReply: explicit denials → deny', () => {
  for (const t of ['no', 'n', 'never', 'deny', 'reddet', 'hayır', 'nope']) {
    assert.equal(parseApprovalReply(t), 'deny', `expected deny for "${t}"`);
  }
});

test('parseApprovalReply: ambiguous text defaults to deny (safety)', () => {
  for (const t of ['', '   ', 'hmm', 'maybe', 'idk', '?', 'who knows']) {
    assert.equal(parseApprovalReply(t), 'deny', `expected deny for "${t}"`);
  }
});

test('parseApprovalReply: leading whitespace ignored', () => {
  assert.equal(parseApprovalReply('   yes'), 'allow');
  assert.equal(parseApprovalReply('\nokay\n'), 'allow');
});
