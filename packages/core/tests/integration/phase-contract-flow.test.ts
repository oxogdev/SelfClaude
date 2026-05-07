import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../../src/orchestrator/index.js';
import { runDualAgentTurn } from '../../src/orchestrator/loop.js';
import {
  EXECUTION_CONTRACT,
  validatePhaseDoc,
  type PhaseContractAttemptEvent,
} from '../../src/orchestrator/phase-contracts.js';

/**
 * Phase 1 (Determinism) end-to-end wiring check. Spawns a real
 * supervisor CC subprocess and asks it to write `01-foundation.md`.
 * Verifies that the phase-contract validation pipeline works:
 *
 *   - The MCP boundary fires `phase-contract-attempt` events.
 *   - On a failed first attempt, sup sees the error message + worked
 *     exemplar and retries within the same turn (MCP-native retry).
 *   - The eventually-written doc satisfies the EXECUTION_CONTRACT.
 *
 * This is a wiring test, not a benchmark. First-pass rate
 * measurement (the ROADMAP "≥60% baseline → ≥80% by sprint end" target)
 * needs many runs and lives in a separate harness — that's a
 * measurement exercise, not a CI gate.
 */

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sc-phase-contract-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  'phase-contract: sup writes a valid 01-foundation.md (with retries if needed)',
  { timeout: 360_000 },
  async () => {
    await withTempDir(async (cwd) => {
      const orch = new Orchestrator({ cwd });
      await orch.start();

      // Auto-answer any ask_user with "OK, proceed." so the test never blocks.
      orch.on('user-question', (q: { id: string }) => {
        setImmediate(() => orch.resolveUserQuestion(q.id, 'OK, proceed.'));
      });

      const attempts: PhaseContractAttemptEvent[] = [];
      orch.on('phase-contract-attempt', (e: PhaseContractAttemptEvent) => {
        attempts.push(e);
      });

      const phaseDocsWritten: string[] = [];
      orch.on('phase-doc-written', (e: { filename: string }) => {
        phaseDocsWritten.push(e.filename);
      });

      try {
        await runDualAgentTurn({
          orchestrator: orch,
          userPrompt:
            `Skip discovery — the project is a tiny URL shortener (Node + Fastify + Postgres). ` +
            `In THIS reply, call write_phase_doc once to create \`01-foundation.md\` (the foundation ` +
            `execution slice: server skeleton, /health endpoint, config module, structured logging, ` +
            `one smoke test). The doc must satisfy the execution-phase-doc contract: required ` +
            `sections are Goal, Scope, Success Criteria, Verification, Out of Scope. ` +
            `If the MCP call returns a validation error, read it and re-call write_phase_doc with a ` +
            `corrected body in the same reply. Do NOT delegate any TASK_FOR_DEVELOPER. Do NOT emit ` +
            `<<READY_TO_EXECUTE>>. Just write the phase doc and stop.`,
        });

        // At least one attempt event must have fired.
        assert.ok(attempts.length >= 1, `expected ≥1 phase-contract-attempt event; got 0`);

        // A doc must have been written eventually.
        assert.ok(
          phaseDocsWritten.length >= 1,
          `expected ≥1 phase-doc-written event; got ${phaseDocsWritten.length}`,
        );

        // The final attempt must be valid (or override; we don't expect override here).
        const lastAttempt = attempts[attempts.length - 1]!;
        assert.equal(
          lastAttempt.valid || lastAttempt.override,
          true,
          `final attempt must be valid OR override. Last: ${JSON.stringify(lastAttempt)}`,
        );

        // The persisted doc must satisfy the contract independently
        // (not just the last validation event — the file on disk is
        // what specialists will read).
        const docPath = join(cwd, 'docs', 'phases', '01-foundation.md');
        const st = await stat(docPath).catch(() => null);
        assert.ok(st, `phase doc should exist at ${docPath}`);
        const content = await readFile(docPath, 'utf8');
        const result = validatePhaseDoc(content, EXECUTION_CONTRACT);
        assert.equal(
          result.valid,
          true,
          `persisted doc must validate. Violations: ${result.violations.map((v) => v.message).join('; ')}`,
        );

        // Informational: first-pass rate for this single run (1.0 if
        // valid on attempt 1, else 0.0). Not asserted — that's a
        // multi-run measurement exercise.
        const firstPass = attempts[0]!.valid ? 1 : 0;
        const total = attempts.length;
        // eslint-disable-next-line no-console
        console.log(
          `[phase-contract] attempts=${total} first-pass=${firstPass} ultimate=${lastAttempt.valid ? 1 : 0}`,
        );
      } finally {
        await orch.stop();
      }
    });
  },
);
