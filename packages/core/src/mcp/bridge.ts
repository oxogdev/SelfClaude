/**
 * SelfClaude MCP stdio bridge.
 *
 * Spawned by Claude Code (per the `--mcp-config` entry installed by the
 * orchestrator). Speaks the MCP stdio protocol on stdin/stdout, and forwards
 * every tool call to the orchestrator over HTTP. The orchestrator does the
 * real work (waiting for the user, surfacing the question on TUI/Telegram,
 * etc.) and returns an `answer` string.
 *
 * Two env vars are required (set by `Orchestrator.hookEnv`):
 *   - SELFCLAUDE_ORCH_URL  e.g. http://127.0.0.1:54321
 *   - SELFCLAUDE_ROLE      'supervisor' | 'developer'
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const ORCH_URL = process.env.SELFCLAUDE_ORCH_URL;
const ROLE = process.env.SELFCLAUDE_ROLE ?? 'unknown';

if (!ORCH_URL) {
  process.stderr.write(
    'selfclaude mcp-bridge: SELFCLAUDE_ORCH_URL not set; refusing to start.\n',
  );
  process.exit(1);
}

const server = new Server(
  { name: 'selfclaude', version: '0.0.1' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'ask_user',
    description:
      'Ask the human user a direct question and wait for their answer. ' +
      'Use this whenever you need a clarification or decision the user must make personally before you can continue. ' +
      'The orchestrator surfaces the question on the user\'s screen, and (if they are away from the screen) escalates to Telegram.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'A plain-language question. Keep it short and self-contained.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional shortlist of expected answers. The user is not constrained to these.',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'high'],
          description: 'Use "high" only when the answer materially blocks progress (faster Telegram escalation).',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'request_user_approval',
    description:
      'Request explicit user approval before performing a risky action — destructive command, scope/architecture change, dependency removal, etc. ' +
      'Returns "allow" or "deny". If the user denies, do not perform the action and adjust your plan.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Short label of what you are about to do (e.g. "drop users table").',
        },
        reason: {
          type: 'string',
          description: 'Why this needs approval and what the consequences are.',
        },
      },
      required: ['action', 'reason'],
    },
  },
  {
    name: 'write_phase_doc',
    description:
      'Write a project phase document into docs/phases/. Use during the documentation phase ' +
      'to record the project brief that the Developer agent will execute against. ' +
      'Filename must be a slug ending in .md (e.g. "00-overview.md", "01-foundation.md"). ' +
      'Returns the absolute path written.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Slug filename, e.g. "00-overview.md".',
        },
        content: {
          type: 'string',
          description: 'Markdown body of the phase doc.',
        },
      },
      required: ['filename', 'content'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === 'ask_user') {
    const resp = await fetch(`${ORCH_URL}/mcp/ask_user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, role: ROLE }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`orchestrator returned ${resp.status}: ${detail}`);
    }
    const body = (await resp.json()) as { answer: string };
    return { content: [{ type: 'text', text: body.answer }] };
  }
  if (name === 'request_user_approval') {
    const resp = await fetch(`${ORCH_URL}/mcp/request_approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, role: ROLE }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`orchestrator returned ${resp.status}: ${detail}`);
    }
    const body = (await resp.json()) as { decision: 'allow' | 'deny' };
    return { content: [{ type: 'text', text: body.decision }] };
  }
  if (name === 'write_phase_doc') {
    const resp = await fetch(`${ORCH_URL}/mcp/write_phase_doc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, role: ROLE }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`orchestrator returned ${resp.status}: ${detail}`);
    }
    const body = (await resp.json()) as { path: string };
    return { content: [{ type: 'text', text: `wrote ${body.path}` }] };
  }
  throw new Error(`unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
