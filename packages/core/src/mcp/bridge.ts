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
// `SELFCLAUDE_AGENT` carries the specialist identity (`developer`,
// `ui-dev`, `security`, …); CC's hook protocol only exposes `role`,
// so the orchestrator side-channels real agent name through this env
// var. Falls back to `role` for legacy single-agent flows.
const AGENT = process.env.SELFCLAUDE_AGENT ?? ROLE;

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
      'Returns the absolute path written.\n\n' +
      'Phase docs are validated against a structural contract (required sections, ' +
      'minimum bullet counts, minimum word counts). On validation failure, the call ' +
      'returns an error message describing what is missing PLUS a worked exemplar — ' +
      're-call the tool with the SAME filename and a corrected body that addresses ' +
      'every issue. After 3 failed attempts, escalate to the operator via ask_user.',
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
        override: {
          type: 'boolean',
          description:
            'Optional: bypass phase-contract validation. Use ONLY after the operator ' +
            'has explicitly approved (via ask_user) that the doc is acceptable as-is. ' +
            'Default false.',
        },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'register_phase_items',
    description:
      'SUPERVISOR-ONLY. Declare the structured Definition-of-Done checklist for a phase ' +
      'when entering it. The phase tracker (`<cwd>/.selfclaude/phases.json`) is the canonical ' +
      'progress source — agents propose items as done, you confirm or reject them, the UI ' +
      'shows live status. Re-registering a phase merges with prior progress: existing items ' +
      'with the same id keep their status + audit trail; new items land as `pending`; items ' +
      'absent from the new list are dropped. Call this once per phase, right after writing ' +
      'the phase doc and before delegating any task.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Phase slug matching the doc filename basename, e.g. "01-foundation".',
        },
        title: {
          type: 'string',
          description: 'Human-readable phase title shown in the UI, e.g. "Phase 01 — Foundation".',
        },
        items: {
          type: 'array',
          description:
            'Checklist items — one DoD per item. Each id is a stable slug used by ' +
            'propose/confirm/reject calls; titles can be edited by re-registering.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Slug id (a-z0-9-), unique within the phase, e.g. "auth-middleware".',
              },
              title: {
                type: 'string',
                description: 'Plain-language DoD line, e.g. "Auth middleware wired and unit-tested".',
              },
            },
            required: ['id', 'title'],
          },
        },
      },
      required: ['slug', 'title', 'items'],
    },
  },
  {
    name: 'propose_item_done',
    description:
      'Any agent can call this. Mark a phase tracker item as `proposed` — meaning "I think ' +
      "I'm done with this; sup, please review.\" The supervisor's inbox gets a notification " +
      'and will see the item highlighted on its next turn for confirm/reject. Include in ' +
      '`notes` what you actually did + how to verify (test command, file path, etc.) so the ' +
      'sup can spot-check without a long round-trip.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Phase slug, e.g. "01-foundation".' },
        itemId: { type: 'string', description: 'Item id assigned at registration.' },
        notes: {
          type: 'string',
          description:
            'What you did + how to verify. Short and specific beats long and vague. Optional ' +
            'but strongly recommended.',
        },
      },
      required: ['slug', 'itemId'],
    },
  },
  {
    name: 'confirm_item_done',
    description:
      'SUPERVISOR-ONLY. Mark a phase tracker item as `done` after reviewing the proposer\'s ' +
      'work (read the diff, run the test command they gave you in notes, sanity-check the ' +
      'file). Use this *only* after verification — flipping a checkbox without a peek defeats ' +
      'the safety net.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        itemId: { type: 'string' },
        notes: {
          type: 'string',
          description: 'Optional confirmation note ("tested with X, looks good").',
        },
      },
      required: ['slug', 'itemId'],
    },
  },
  {
    name: 'reject_item_done',
    description:
      'SUPERVISOR-ONLY. Send a proposed item back to `pending` with a reason — when review ' +
      "reveals the proposer missed something. The proposer's inbox gets the rejection text " +
      'so they pick up the fix on their next turn. Be specific: what was missed, what to do ' +
      'next, which file/test to address.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        itemId: { type: 'string' },
        reason: {
          type: 'string',
          description: 'Required. Why it failed review + what the proposer should fix.',
        },
      },
      required: ['slug', 'itemId', 'reason'],
    },
  },
  {
    name: 'propose_script',
    description:
      'SUPERVISOR-ONLY. Propose a recurring Bash command as a reusable script. The operator ' +
      'reviews + approves through the web UI; once approved, the script lands at ' +
      '`<cwd>/.selfclaude/scripts/<slug>.sh` and you invoke it via the regular `Bash` tool ' +
      '(`./.selfclaude/scripts/<slug>.sh`). Use this when you find yourself running the same ' +
      "Bash command 3+ times — it's a token saver and gives the operator a vetted toolbox to " +
      'inspect and reuse across projects.\n\n' +
      'Slug rules: kebab-case (a-z, 0-9, hyphen), max 63 chars. Pick a name that reads like ' +
      'what the script does (`check-types`, `run-smoke-test`, `dump-schema`).\n\n' +
      "Body rules: standalone Bash. No relative-cwd assumptions — write `cd \"$(dirname \"$0\")/../..\"` " +
      "if you need the project root. The orchestrator prepends `set -euo pipefail` and a " +
      'metadata header on approval; you only supply the body lines.\n\n' +
      'Reason rules: explain *why* this is worth a script (how often you call it, what the ' +
      'output is for). The operator reads this verbatim before approving — be specific.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'kebab-case identifier, e.g. "check-types".',
        },
        body: {
          type: 'string',
          description: 'Bash script body (no shebang — orchestrator prepends).',
        },
        reason: {
          type: 'string',
          description: 'Why this script is worth approving (use case + frequency).',
        },
      },
      required: ['slug', 'body', 'reason'],
    },
  },
  {
    name: 'apply_agent_dna',
    description:
      'SUPERVISOR-ONLY. Apply a bundled DNA template to this project — opts a specific agent ' +
      "into a deeper standards contract. Today's catalogue: `admin-panel` (targets ui-dev with " +
      'strict topology, shadcn + Tailwind v4, locked stack, AppModal/DataTable family, theme ' +
      'tokens). Call this at bootstrap *only when the project shape matches* the template — ' +
      'e.g. apply admin-panel for an admin/dashboard project but NOT for a marketing site or ' +
      'mobile app. Idempotent: returns "already-applied" if the file exists, so re-running is ' +
      'safe and never clobbers operator hand-edits.',
    inputSchema: {
      type: 'object',
      properties: {
        dnaSlug: {
          type: 'string',
          description: 'DNA template slug (e.g. "admin-panel"). Picks the file from the bundled registry.',
        },
        force: {
          type: 'boolean',
          description: 'Overwrite an existing DNA file instead of returning "already-applied". Rare — usually preserves operator edits.',
        },
      },
      required: ['dnaSlug'],
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
      // Surface the orchestrator's error message verbatim — for phase-contract
      // validation failures the body is `{error: "<retry message + exemplar>"}`,
      // and the model needs that text intact (HTTP status noise hurts the
      // teach-the-pattern goal). Fall back to raw text for non-JSON errors.
      const detail = await resp.text().catch(() => '');
      let msg = detail;
      try {
        const parsed = JSON.parse(detail) as { error?: unknown };
        if (typeof parsed.error === 'string') msg = parsed.error;
      } catch {
        /* not JSON, fall through to raw text */
      }
      throw new Error(msg || `orchestrator returned ${resp.status}`);
    }
    const body = (await resp.json()) as { path: string };
    return { content: [{ type: 'text', text: `wrote ${body.path}` }] };
  }
  // Phase tracker + agent-DNA + script proposal family — all share the
  // same `{ok, message}` response shape and pass `role` + `agent` so
  // the orchestrator can attribute calls to the actual specialist
  // (developer / ui-dev / supervisor / …).
  const ackToolPaths: Record<string, string> = {
    register_phase_items: '/mcp/register_phase_items',
    propose_item_done: '/mcp/propose_item_done',
    confirm_item_done: '/mcp/confirm_item_done',
    reject_item_done: '/mcp/reject_item_done',
    apply_agent_dna: '/mcp/apply_agent_dna',
    propose_script: '/mcp/propose_script',
  };
  const ackPath = ackToolPaths[name];
  if (ackPath) {
    const resp = await fetch(`${ORCH_URL}${ackPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, role: ROLE, agent: AGENT }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`orchestrator returned ${resp.status}: ${detail}`);
    }
    const body = (await resp.json()) as { ok: boolean; message: string };
    if (!body.ok) {
      throw new Error(body.message || `${name} failed`);
    }
    return { content: [{ type: 'text', text: body.message }] };
  }
  throw new Error(`unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
