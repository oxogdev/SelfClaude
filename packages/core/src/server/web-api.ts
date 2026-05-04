import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SessionManager } from './session-manager.js';
import { streamSseFromEmitter } from './sse.js';
import { log } from '../lib/log.js';

export interface WebApiOptions {
  port?: number;
  host?: string;
  manager?: SessionManager;
}

export interface WebApiHandle {
  server: FastifyInstance;
  manager: SessionManager;
  url: string;
  port: number;
}

const VERSION = '0.0.1';

export function buildWebApi(manager: SessionManager): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/api/health', async () => ({
    version: VERSION,
    uptime: process.uptime(),
    sessions: manager.listSessions().length,
  }));

  server.get('/api/sessions', async () => ({ sessions: manager.listSessions() }));

  server.post('/api/sessions', async (req, reply) => {
    const Schema = z.object({ cwd: z.string().min(1), label: z.string().optional() });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const meta = await manager.createSession(parsed.data);
      return meta;
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.delete('/api/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      await manager.destroySession(id);
      return reply.code(204).send();
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  server.get('/api/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const snap = await manager.getSnapshot(id);
    if (!snap) return reply.code(404).send({ error: 'session not found' });
    return snap;
  });

  server.post('/api/sessions/:id/message', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const Schema = z.object({ text: z.string().min(1) });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      await manager.sendMessage(id, parsed.data.text);
      return reply.code(202).send({ accepted: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  server.post('/api/sessions/:id/dev-note', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const Schema = z.object({ text: z.string().min(1) });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      await manager.noteForDeveloper(id, parsed.data.text);
      return reply.code(202).send({ accepted: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  server.post('/api/sessions/:id/answer-question', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const Schema = z.object({ questionId: z.string(), answer: z.string() });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const ok = await manager.resolveQuestion(id, parsed.data.questionId, parsed.data.answer);
    return { ok };
  });

  server.post('/api/sessions/:id/decide-approval', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const Schema = z.object({
      approvalId: z.string(),
      decision: z.enum(['allow', 'deny']),
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const ok = await manager.resolveApproval(id, parsed.data.approvalId, parsed.data.decision);
    return { ok };
  });

  server.get('/api/sessions/:id/events', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ctx = manager.getSession(id);
    if (!ctx) {
      return reply.code(404).send({ error: 'session not found' });
    }
    streamSseFromEmitter(reply, ctx.emitter);
  });

  server.get('/api/browse', async (req, reply) => {
    const Schema = z.object({ path: z.string().optional() });
    const parsed = Schema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const path = parsed.data.path ?? homedir();
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return {
        path,
        parent: path === '/' ? null : dirname(path),
        entries: entries
          .map((e) => ({
            name: e.name,
            isDir: e.isDirectory(),
            isHidden: e.name.startsWith('.'),
          }))
          .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)),
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  return server;
}

export async function startWebApi(opts: WebApiOptions = {}): Promise<WebApiHandle> {
  const port = opts.port ?? 7423;
  const host = opts.host ?? '127.0.0.1';
  const manager = opts.manager ?? new SessionManager();
  const server = buildWebApi(manager);
  await server.listen({ host, port });
  const url = `http://${host}:${port}`;
  log('info', 'web-api.started', { url });
  return { server, manager, url, port };
}
