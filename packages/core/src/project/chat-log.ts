import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const ChatLogEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user-message'), text: z.string(), ts: z.number() }),
  z.object({ type: z.literal('sup-message'), text: z.string(), ts: z.number() }),
  z.object({ type: z.literal('dev-text'), text: z.string(), ts: z.number() }),
  z.object({
    type: z.literal('dev-tool-call'),
    id: z.string(),
    toolUseId: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
    ts: z.number(),
  }),
  z.object({
    type: z.literal('dev-tool-result'),
    toolUseId: z.string(),
    text: z.string(),
    isError: z.boolean(),
    ts: z.number(),
  }),
  z.object({ type: z.literal('task-marker'), summary: z.string(), ts: z.number() }),
  z.object({
    type: z.literal('turn-marker'),
    turnIndex: z.number(),
    who: z.enum(['sup', 'dev']),
    ts: z.number(),
  }),
  z.object({ type: z.literal('phase-doc-written'), filename: z.string(), ts: z.number() }),
  z.object({
    type: z.literal('question'),
    id: z.string(),
    text: z.string(),
    options: z.array(z.string()).optional(),
    ts: z.number(),
  }),
  z.object({
    type: z.literal('question-resolved'),
    id: z.string(),
    answer: z.string(),
    ts: z.number(),
  }),
  z.object({
    type: z.literal('approval'),
    id: z.string(),
    action: z.string(),
    reason: z.string(),
    ts: z.number(),
  }),
  z.object({
    type: z.literal('approval-resolved'),
    id: z.string(),
    decision: z.enum(['allow', 'deny']),
    ts: z.number(),
  }),
  z.object({ type: z.literal('iteration-end'), iteration: z.number(), ts: z.number() }),
  z.object({
    type: z.literal('user-note-dev'),
    text: z.string(),
    ts: z.number(),
  }),
]);

export type ChatLogEntry = z.infer<typeof ChatLogEntrySchema>;

export function chatLogPath(cwd: string): string {
  return join(cwd, '.selfclaude', 'chat-log.jsonl');
}

export async function appendChatLogEntry(cwd: string, entry: ChatLogEntry): Promise<void> {
  const path = chatLogPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`);
}

/**
 * Read all entries from the chat-log. Malformed/unparseable lines are
 * skipped silently — the log is append-only and we must not lose newer
 * entries because of one bad earlier line.
 */
export async function readChatLog(cwd: string): Promise<ChatLogEntry[]> {
  const path = chatLogPath(cwd);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const entries: ChatLogEntry[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      const result = ChatLogEntrySchema.safeParse(parsed);
      if (result.success) entries.push(result.data);
    } catch {
      // skip malformed line
    }
  }
  return entries;
}
