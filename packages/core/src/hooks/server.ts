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
  ApplyAgentDnaHttpRequestSchema,
  AskUserHttpRequestSchema,
  ConfirmItemDoneHttpRequestSchema,
  ProposeItemDoneHttpRequestSchema,
  ProposeScriptHttpRequestSchema,
  RegisterPhaseItemsHttpRequestSchema,
  RejectItemDoneHttpRequestSchema,
  RequestApprovalHttpRequestSchema,
  WritePhaseDocHttpRequestSchema,
  type ApplyAgentDnaHttpRequest,
  type ApplyAgentDnaHttpResponse,
  type AskUserHttpRequest,
  type ConfirmItemDoneHttpRequest,
  type PhaseTrackerHttpResponse,
  type ProposeItemDoneHttpRequest,
  type ProposeScriptHttpRequest,
  type ProposeScriptHttpResponse,
  type RegisterPhaseItemsHttpRequest,
  type RejectItemDoneHttpRequest,
  type RequestApprovalHttpRequest,
  type WritePhaseDocHttpRequest,
} from '../mcp/types.js';
import { log } from '../lib/log.js';

export interface HookCallbacks {
  onStop: (role: Role, agent: string, payload: unknown) => void;
  onPreToolUse: (
    role: Role,
    agent: string,
    payload: { tool_name: string; tool_input: unknown },
  ) => Promise<{ decision: PermissionDecision; reason?: string }>;
  onUserPromptSubmit: (role: Role, agent: string, payload: unknown) => string;
  onAskUser: (req: AskUserHttpRequest) => Promise<{ answer: string }>;
  onRequestApproval: (req: RequestApprovalHttpRequest) => Promise<{ decision: 'allow' | 'deny' }>;
  onWritePhaseDoc: (req: WritePhaseDocHttpRequest) => Promise<{ path: string }>;
  /* Phase tracker family — see `mcp/types.ts` for schema details. */
  onRegisterPhaseItems: (req: RegisterPhaseItemsHttpRequest) => Promise<PhaseTrackerHttpResponse>;
  onProposeItemDone: (req: ProposeItemDoneHttpRequest) => Promise<PhaseTrackerHttpResponse>;
  onConfirmItemDone: (req: ConfirmItemDoneHttpRequest) => Promise<PhaseTrackerHttpResponse>;
  onRejectItemDone: (req: RejectItemDoneHttpRequest) => Promise<PhaseTrackerHttpResponse>;
  /** Apply a bundled DNA template to this project — see `agents/dna.ts`. */
  onApplyAgentDna: (req: ApplyAgentDnaHttpRequest) => Promise<ApplyAgentDnaHttpResponse>;
  /** Sup-only: propose a recurring Bash command as a reusable script. */
  onProposeScript: (req: ProposeScriptHttpRequest) => Promise<ProposeScriptHttpResponse>;
}

export interface HookServerHandle {
  server: FastifyInstance;
  url: string;
  port: number;
}

const QuerySchema = z.object({
  role: RoleSchema,
  /**
   * Specialist identity injected by `selfclaude` via env → hook script
   * → query string. Falls back to `role` for legacy callers. Required so
   * file locks and tool attribution stay correct under parallel
   * dispatch where two subprocesses share `role='developer'`.
   */
  agent: z.string().min(1).optional(),
});

export function buildHookServer(callbacks: HookCallbacks): FastifyInstance {
  const server = Fastify({ logger: false });

  server.post('/hook/stop', async (req, reply) => {
    const parsedQuery = QuerySchema.parse(req.query);
    const role = parsedQuery.role;
    const agent = parsedQuery.agent ?? role;
    const parsed = StopHookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.stop.invalid', { reason: parsed.error.message });
      return reply.code(204).send();
    }
    callbacks.onStop(role, agent, parsed.data);
    return reply.code(204).send();
  });

  server.post('/hook/pretool', async (req, reply) => {
    const parsedQuery = QuerySchema.parse(req.query);
    const role = parsedQuery.role;
    const agent = parsedQuery.agent ?? role;
    const parsed = PreToolUsePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.pretool.invalid', { reason: parsed.error.message });
      return reply.send({});
    }
    const { decision, reason } = await callbacks.onPreToolUse(role, agent, {
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
    const parsedQuery = QuerySchema.parse(req.query);
    const role = parsedQuery.role;
    const agent = parsedQuery.agent ?? role;
    const parsed = UserPromptSubmitPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      log('warn', 'hook.prompt.invalid', { reason: parsed.error.message });
      return reply.send({});
    }
    const additionalContext = callbacks.onUserPromptSubmit(role, agent, parsed.data);
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

  // Phase tracker family. Each handler returns `{ ok, message }` so the
  // bridge can either surface the message text back to the agent on
  // success or throw on failure (the orchestrator's domain validation
  // — e.g. "no such phase / item" — flows through `ok: false`).
  server.post('/mcp/register_phase_items', async (req, reply) => {
    const parsed = RegisterPhaseItemsHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onRegisterPhaseItems(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.register_phase_items.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.post('/mcp/propose_item_done', async (req, reply) => {
    const parsed = ProposeItemDoneHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onProposeItemDone(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.propose_item_done.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.post('/mcp/confirm_item_done', async (req, reply) => {
    const parsed = ConfirmItemDoneHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onConfirmItemDone(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.confirm_item_done.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.post('/mcp/reject_item_done', async (req, reply) => {
    const parsed = RejectItemDoneHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onRejectItemDone(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.reject_item_done.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.post('/mcp/apply_agent_dna', async (req, reply) => {
    const parsed = ApplyAgentDnaHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onApplyAgentDna(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.apply_agent_dna.failed', { reason: (e as Error).message });
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.post('/mcp/propose_script', async (req, reply) => {
    const parsed = ProposeScriptHttpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const result = await callbacks.onProposeScript(parsed.data);
      return reply.send(result);
    } catch (e) {
      log('warn', 'mcp.propose_script.failed', { reason: (e as Error).message });
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
