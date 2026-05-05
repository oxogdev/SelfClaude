import type { FastifyReply } from 'fastify';
import type { EventEmitter } from 'node:events';
import type { SessionEvent } from './session-manager.js';

/**
 * Pipe a session's `emitter` (event-named "event", payload SessionEvent) to
 * a Fastify reply as a Server-Sent Events stream. Heartbeat every 30 s keeps
 * intermediate proxies from idling out.
 */
export function streamSseFromEmitter(reply: FastifyReply, emitter: EventEmitter): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
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
