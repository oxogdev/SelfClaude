import { join } from 'node:path';
import { workspacePaths } from '../hooks/installer.js';
import { readProjectState, type ProjectState } from './state.js';

export type ProjectDetection =
  | { kind: 'new'; statePath: string }
  | { kind: 'existing'; statePath: string; state: ProjectState };

/**
 * Figure out whether `cwd` is a brand-new SelfClaude target or one we've
 * worked on before. Existence (and validity) of `.selfclaude/state.json`
 * is the single source of truth.
 */
export async function detectProject(cwd: string): Promise<ProjectDetection> {
  const ws = workspacePaths(cwd);
  const statePath = join(ws.workspaceDir, 'state.json');
  const state = await readProjectState(statePath);
  if (state) return { kind: 'existing', statePath, state };
  return { kind: 'new', statePath };
}
