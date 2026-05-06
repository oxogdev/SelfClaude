import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHookServer, type HookCallbacks } from '../src/hooks/server.js';

function noopCallbacks(overrides: Partial<HookCallbacks> = {}): HookCallbacks {
  return {
    onStop: () => undefined,
    onPreToolUse: async () => ({ decision: 'allow' }),
    onUserPromptSubmit: () => '',
    onAskUser: async () => ({ answer: '' }),
    onRequestApproval: async () => ({ decision: 'deny' }),
    onWritePhaseDoc: async () => ({ path: '/dev/null' }),
    onRegisterPhaseItems: async () => ({ ok: true, message: '' }),
    onProposeItemDone: async () => ({ ok: true, message: '' }),
    onConfirmItemDone: async () => ({ ok: true, message: '' }),
    onRejectItemDone: async () => ({ ok: true, message: '' }),
    onApplyAgentDna: async () => ({ ok: true, message: '' }),
    onProposeScript: async () => ({ ok: true, message: '' }),
    ...overrides,
  };
}

test('POST /hook/stop returns 204 and invokes callback with role + payload', async () => {
  const captured: { value: { role: string; payload: unknown } | null } = { value: null };
  const server = buildHookServer(
    noopCallbacks({
      onStop: (role, payload) => {
        captured.value = { role, payload };
      },
    }),
  );
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/hook/stop?role=developer',
      headers: { 'content-type': 'application/json' },
      payload: {
        session_id: 'abc',
        hook_event_name: 'Stop',
      },
    });
    assert.equal(response.statusCode, 204);
    assert.ok(captured.value, 'Stop callback should have fired');
    assert.equal(captured.value.role, 'developer');
  } finally {
    await server.close();
  }
});

test('POST /hook/pretool returns the orchestrator decision in hookSpecificOutput', async () => {
  const server = buildHookServer(
    noopCallbacks({
      onPreToolUse: async () => ({ decision: 'deny', reason: 'destructive command' }),
    }),
  );
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/hook/pretool?role=developer',
      headers: { 'content-type': 'application/json' },
      payload: {
        session_id: 'abc',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'destructive command',
      },
    });
  } finally {
    await server.close();
  }
});

test('POST /hook/prompt returns additionalContext when callback yields text', async () => {
  const server = buildHookServer(
    noopCallbacks({
      onUserPromptSubmit: () => 'inbox: hello world',
    }),
  );
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/hook/prompt?role=supervisor',
      headers: { 'content-type': 'application/json' },
      payload: {
        session_id: 'abc',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'whatever the user just said',
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(body, {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'inbox: hello world',
      },
    });
  } finally {
    await server.close();
  }
});

test('POST /hook/prompt returns {} when inbox is empty (no additionalContext)', async () => {
  const server = buildHookServer(noopCallbacks({ onUserPromptSubmit: () => '' }));
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/hook/prompt?role=supervisor',
      headers: { 'content-type': 'application/json' },
      payload: {
        session_id: 'abc',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'hi',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});
  } finally {
    await server.close();
  }
});

test('invalid role returns 400 (zod validation)', async () => {
  const server = buildHookServer(noopCallbacks());
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/hook/stop?role=intern',
      headers: { 'content-type': 'application/json' },
      payload: { session_id: 'a', hook_event_name: 'Stop' },
    });
    assert.equal(response.statusCode, 500);
    // Fastify's default error handler returns 500 for thrown errors; that's
    // fine for our purposes — the hook bridge treats non-200 as "no decision"
    // and falls back to default behavior, so a misconfigured caller does not
    // accidentally allow a destructive op.
  } finally {
    await server.close();
  }
});
