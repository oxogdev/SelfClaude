import { z } from 'zod';

const SystemEventSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

const AssistantEventSchema = z
  .object({
    type: z.literal('assistant'),
    message: z
      .object({
        role: z.literal('assistant'),
        content: z.array(z.unknown()),
      })
      .passthrough(),
    session_id: z.string().optional(),
  })
  .passthrough();

const UserEventSchema = z
  .object({
    type: z.literal('user'),
    session_id: z.string().optional(),
  })
  .passthrough();

const ResultEventSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    session_id: z.string().optional(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    num_turns: z.number().optional(),
    stop_reason: z.string().optional(),
    permission_denials: z.array(z.unknown()).optional(),
  })
  .passthrough();

const GenericEventSchema = z.object({ type: z.string() }).passthrough();

export const StreamEventSchema = z.union([
  SystemEventSchema,
  AssistantEventSchema,
  UserEventSchema,
  ResultEventSchema,
  GenericEventSchema,
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

export interface ParseError {
  line: string;
  reason: string;
}

/**
 * Stateful line-buffering parser for `claude --output-format stream-json` stdout.
 * Feed it stdout chunks; receive parsed events back. Handles split chunks across newlines.
 */
export class StreamJsonParser {
  private buf = '';
  private readonly errors: ParseError[] = [];

  feed(chunk: string): StreamEvent[] {
    this.buf += chunk;
    const out: StreamEvent[] = [];
    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) {
        const evt = this.parseLine(line);
        if (evt) out.push(evt);
      }
      nl = this.buf.indexOf('\n');
    }
    return out;
  }

  /** Drain remaining buffer (call after process exit). */
  flush(): StreamEvent[] {
    const remainder = this.buf.trim();
    this.buf = '';
    if (!remainder) return [];
    const evt = this.parseLine(remainder);
    return evt ? [evt] : [];
  }

  getErrors(): readonly ParseError[] {
    return this.errors;
  }

  private parseLine(line: string): StreamEvent | null {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (e) {
      this.errors.push({ line, reason: `JSON.parse: ${(e as Error).message}` });
      return null;
    }
    const result = StreamEventSchema.safeParse(json);
    if (result.success) return result.data;
    this.errors.push({ line, reason: result.error.message });
    return null;
  }
}

/**
 * Result metrics emitted by Claude Code at the end of every turn. We use
 * these to build the bottom-toolbar cost/duration badges and to notice
 * pathological turns (sky-high cost, multi-minute duration).
 */
export interface ResultMetrics {
  costUsd: number;
  durationMs: number;
  numTurns: number;
  stopReason: string | null;
}

export function extractResultMetrics(evt: StreamEvent): ResultMetrics | null {
  if (evt.type !== 'result') return null;
  const e = evt as {
    total_cost_usd?: number;
    duration_ms?: number;
    num_turns?: number;
    stop_reason?: string;
  };
  return {
    costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : 0,
    durationMs: typeof e.duration_ms === 'number' ? e.duration_ms : 0,
    numTurns: typeof e.num_turns === 'number' ? e.num_turns : 0,
    stopReason: typeof e.stop_reason === 'string' ? e.stop_reason : null,
  };
}

export function extractAssistantText(evt: StreamEvent): string {
  if (evt.type !== 'assistant') return '';
  const message = (evt as { message?: { content?: unknown[] } }).message;
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string'
    ) {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.join('');
}

export function extractSessionId(evt: StreamEvent): string | null {
  const sid = (evt as { session_id?: unknown }).session_id;
  return typeof sid === 'string' ? sid : null;
}

/**
 * Extract a token-level text delta from a `stream_event` (only emitted
 * when the upstream was launched with `--include-partial-messages`).
 * Anthropic stream-json shape:
 *   {type: 'stream_event', event: {type: 'content_block_delta',
 *     delta: {type: 'text_delta', text: '…'}}}
 */
export function extractStreamTextDelta(evt: StreamEvent): string | null {
  if (evt.type !== 'stream_event') return null;
  const inner = (evt as { event?: { type?: string; delta?: { type?: string; text?: string } } })
    .event;
  if (!inner) return null;
  if (inner.type !== 'content_block_delta') return null;
  if (inner.delta?.type !== 'text_delta') return null;
  return typeof inner.delta.text === 'string' ? inner.delta.text : null;
}

/**
 * Extract a token-level THINKING delta. Same partial-messages mechanism
 * as `extractStreamTextDelta`, but the delta type is `thinking_delta` and
 * the field is `thinking` rather than `text`. Surfacing thinking lets
 * the operator watch the model reason in real time.
 */
export function extractStreamThinkingDelta(evt: StreamEvent): string | null {
  if (evt.type !== 'stream_event') return null;
  const inner = (
    evt as {
      event?: { type?: string; delta?: { type?: string; thinking?: string } };
    }
  ).event;
  if (!inner) return null;
  if (inner.type !== 'content_block_delta') return null;
  if (inner.delta?.type !== 'thinking_delta') return null;
  return typeof inner.delta.thinking === 'string' ? inner.delta.thinking : null;
}

/**
 * Pull `thinking` content blocks out of an assembled assistant event.
 * Used at message-complete time to persist the full thinking text to the
 * chat-log (the partial deltas only update the live UI).
 */
export function extractAssistantThinking(evt: StreamEvent): string {
  if (evt.type !== 'assistant') return '';
  const message = (evt as { message?: { content?: unknown[] } }).message;
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'thinking' &&
      typeof (item as { thinking?: unknown }).thinking === 'string'
    ) {
      parts.push((item as { thinking: string }).thinking);
    }
  }
  return parts.join('');
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  toolUseId: string;
  text: string;
  isError: boolean;
}

/**
 * Pull tool_use content blocks out of an assistant event. Each block carries
 * its own id (used to pair with a later tool_result), name, and full input.
 */
export function extractToolUses(evt: StreamEvent): ToolUseBlock[] {
  if (evt.type !== 'assistant') return [];
  const message = (evt as { message?: { content?: unknown[] } }).message;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const out: ToolUseBlock[] = [];
  for (const item of content) {
    if (
      typeof item !== 'object' ||
      item === null ||
      (item as { type?: unknown }).type !== 'tool_use'
    ) {
      continue;
    }
    const id = (item as { id?: unknown }).id;
    const name = (item as { name?: unknown }).name;
    const input = (item as { input?: unknown }).input;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    out.push({
      id,
      name,
      input: typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {},
    });
  }
  return out;
}

/**
 * Pull tool_result blocks out of a `user`-typed event (Claude Code emits
 * tool results as synthetic user messages whose content is `tool_result`
 * blocks pointing back to the corresponding tool_use_id).
 */
export function extractToolResults(evt: StreamEvent): ToolResultBlock[] {
  if (evt.type !== 'user' && evt.type !== 'assistant') return [];
  const message = (evt as { message?: { content?: unknown[] } }).message;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const out: ToolResultBlock[] = [];
  for (const item of content) {
    if (
      typeof item !== 'object' ||
      item === null ||
      (item as { type?: unknown }).type !== 'tool_result'
    ) {
      continue;
    }
    const toolUseId = (item as { tool_use_id?: unknown }).tool_use_id;
    if (typeof toolUseId !== 'string') continue;
    const isError = (item as { is_error?: unknown }).is_error === true;
    const rawContent = (item as { content?: unknown }).content;
    let text = '';
    if (typeof rawContent === 'string') {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      const parts: string[] = [];
      for (const c of rawContent) {
        if (
          typeof c === 'object' &&
          c !== null &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string'
        ) {
          parts.push((c as { text: string }).text);
        }
      }
      text = parts.join('\n');
    }
    out.push({ toolUseId, text, isError });
  }
  return out;
}
