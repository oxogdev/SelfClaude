import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type Inbox = 'supervisor' | 'developer';
export type MessageSource = 'orchestrator' | 'supervisor' | 'developer' | 'user';

export interface InboxMessage {
  id: string;
  to: Inbox;
  source: MessageSource;
  body: string;
  metadata?: Record<string, unknown>;
  ts: number;
}

/**
 * In-memory inboxes for inter-agent messaging. Producers (supervisor parsing,
 * developer Stop hook, user input) call `enqueue`; the UserPromptSubmit hook
 * for a given role calls `drain` at turn-start and injects the contents via
 * `additionalContext`. Persistence to .selfclaude/messages/*.jsonl lands in M8.
 */
export class MessageBus extends EventEmitter {
  private readonly queues: Record<Inbox, InboxMessage[]> = {
    supervisor: [],
    developer: [],
  };

  enqueue(msg: Omit<InboxMessage, 'id' | 'ts'>): InboxMessage {
    const full: InboxMessage = { ...msg, id: randomUUID(), ts: Date.now() };
    this.queues[full.to].push(full);
    this.emit('enqueued', full);
    return full;
  }

  drain(target: Inbox): InboxMessage[] {
    const out = this.queues[target];
    this.queues[target] = [];
    if (out.length > 0) this.emit('drained', target, out.length);
    return out;
  }

  peek(target: Inbox): readonly InboxMessage[] {
    return [...this.queues[target]];
  }

  size(target: Inbox): number {
    return this.queues[target].length;
  }
}
