import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * On-disk representation of a SelfClaude project's persistent state.
 *
 * Lives at `<cwd>/.selfclaude/state.json`. Updated after every loop turn so
 * a fresh `selfclaude start` in the same directory can pick up where the
 * previous session left off (resumed CC sessions, current phase, written
 * phase docs).
 */
export const ProjectStateSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  phase: z.enum(['discovery', 'docs', 'phase-loop']),
  supervisorSessionId: z.string().nullable(),
  developerSessionId: z.string().nullable(),
  phaseDocs: z.array(z.string()).default([]),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type ProjectPhase = ProjectState['phase'];

export function newProjectState(): ProjectState {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    phase: 'discovery',
    supervisorSessionId: null,
    developerSessionId: null,
    phaseDocs: [],
  };
}

/**
 * Read and validate the state file. Returns null when the file does not exist;
 * throws on malformed content (corrupted state should surface to the user
 * rather than silently nuke their session continuity).
 */
export async function readProjectState(path: string): Promise<ProjectState | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw e;
  }
  const json: unknown = JSON.parse(raw);
  return ProjectStateSchema.parse(json);
}

export async function writeProjectState(path: string, state: ProjectState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}
