import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EventEmitter } from 'node:events';
import type { SessionEvent } from './session-manager.js';

/**
 * Localhost-only origin allowlist for SSE responses. The orchestrator
 * binds to 127.0.0.1 by design; if a non-loopback origin lands in the
 * request it's either a misconfigured browser extension or something
 * weirder, neither of which deserves an open SSE stream. Wildcard
 * `Access-Control-Allow-Origin: *` was the previous default — this
 * tightens it without breaking the dev flow (Next on :3000 → API on
 * :7423 still works).
 *
 * Bumped per PR #1 (Ersin KOÇ — security pass).
 */
const ALLOWED_SSE_ORIGINS = new Set<string>([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost',
  'http://127.0.0.1',
]);

/**
 * Validate the request's `Origin` header against the localhost allowlist.
 * Returns the origin verbatim when accepted; `undefined` otherwise (in
 * which case we omit the CORS header entirely — the browser blocks the
 * read, the server hasn't claimed permissive cross-origin access).
 */
export function resolveSseOrigin(req: FastifyRequest): string | undefined {
  const raw = req.headers['origin'];
  if (typeof raw !== 'string') return undefined;
  return ALLOWED_SSE_ORIGINS.has(raw) ? raw : undefined;
}

/**
 * Pipe a session's `emitter` (event-named "event", payload SessionEvent) to
 * a Fastify reply as a Server-Sent Events stream. Heartbeat every 30 s keeps
 * intermediate proxies from idling out.
 *
 * `allowedOrigin` is set when the caller validated the request's Origin
 * header against the localhost allowlist. When `undefined`, the response
 * carries no `Access-Control-Allow-Origin` header (browser blocks the
 * read; same-origin requests still succeed).
 */
export function streamSseFromEmitter(
  reply: FastifyReply,
  emitter: EventEmitter,
  allowedOrigin?: string,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Vary'] = 'Origin';
  }
  reply.raw.writeHead(200, headers);
  // Disable Nagle so each SSE frame is flushed to the wire immediately
  // — without this, token-level deltas can sit in the kernel buffer.
  const sock = reply.raw.socket;
  if (sock && 'setNoDelay' in sock) {
    sock.setNoDelay(true);
  }

  const handler = (event: SessionEvent) => {
    reply.raw.write(`event: ${event.kind}\n`);
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  emitter.on('event', handler);

  reply.raw.write('event: ready\ndata: {}\n\n');

  const heartbeat = setInterval(() => {
    reply.raw.write(': heartbeat\n\n');
  }, 30_000);

  reply.raw.on('close', () => {
    clearInterval(heartbeat);
    emitter.off('event', handler);
  });
}
