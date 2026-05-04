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
