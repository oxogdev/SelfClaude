import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PreToolUsePayloadSchema,
  RoleSchema,
  StopHookPayloadSchema,
  UserPromptSubmitPayloadSchema,
  type PermissionDecision,
  type Role,
} from './types.js';
import {
  AskUserHttpRequestSchema,
  RequestApprovalHttpRequestSchema,
  WritePhaseDocHttpRequestSchema,
  type AskUserHttpRequest,
  type RequestApprovalHttpRequest,
  type WritePhaseDocHttpRequest,
} from '../mcp/types.js';
import { log } from '../lib/log.js';

export interface HookCallbacks {
  onStop: (role: Role, payload: unknown) => void;
  onPreToolUse: (
    role: Role,
    payload: { tool_name: string; tool_input: unknown },
  ) => Promise<{ decision: PermissionDecision; reason?: string }>;
  onUserPromptSubmit: (role: Role, payload: unknown) => string;
  onAskUser: (req: AskUserHttpRequest) => Promise<{ answer: string }>;
  onRequestApproval: (req: RequestApprovalHttpRequest) => Promise<{ decision: 'allow' | 'deny' }>;
  onWritePhaseDoc: (req: WritePhaseDocHttpRequest) => Promise<{ path: string }>;
}

export interface HookServerHandle {
  server: FastifyInstance;
  url: string;
  port: number;
}

const QuerySchema = z.object({ role: RoleSchema });

export function buildHookServer(callbacks: HookCallbacks): FastifyInstance {
  const server = Fastify({ logger: false });

  server.post('/hook/stop', async (req, reply) => {
    const role = QuerySchema.parse(req.query).role;
    const parsed = StopHookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.stop.invalid', { reason: parsed.error.message });
      return reply.code(204).send();
    }
    callbacks.onStop(role, parsed.data);
    return reply.code(204).send();
  });

  server.post('/hook/pretool', async (req, reply) => {
    const role = QuerySchema.parse(req.query).role;
    const parsed = PreToolUsePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.pretool.invalid', { reason: parsed.error.message });
      return reply.send({});
    }
    const { decision, reason } = await callbacks.onPreToolUse(role, {
      tool_name: parsed.data.tool_name,
      tool_input: parsed.data.tool_input,
    });
    return reply.send({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        ...(reason ? { permissionDecisionReason: reason } : {}),
      },
    });
  });

  server.post('/hook/prompt', async (req, reply) => {
    const role = QuerySchema.parse(req.query).role;
    const parsed = UserPromptSubmitPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.prompt.invalid', { reason: parsed.error.message });
      return reply.send({});
    }
    const additionalContext = callbacks.onUserPromptSubmit(role, parsed.data);
    if (!additionalContext) return reply.send({});
    return reply.send({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    });
  });

  server.post('/mcp/ask_user', async (req, reply) => {
    const parsed = AskUserHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const result = await callbacks.onAskUser(parsed.data);
    return reply.send(result);
  });

  server.post('/mcp/request_approval', async (req, reply) => {
    const parsed = RequestApprovalHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const result = await callbacks.onRequestApproval(parsed.data);
    return reply.send(result);
  });

  server.post('/mcp/write_phase_doc', async (req, reply) => {
    const parsed = WritePhaseDocHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onWritePhaseDoc(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.write_phase_doc.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  return server;
}

export async function startHookServer(callbacks: HookCallbacks): Promise<HookServerHandle> {
  const server = buildHookServer(callbacks);
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  if (typeof addr !== 'object' || addr === null) {
    throw new Error('hook server failed to bind');
  }
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;
  log('info', 'hook.server.started', { url });
  return { server, url, port };
}
