import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from '../lib/env.js';
import { log } from '../lib/log.js';

const SCRIPT_FILES = ['stop.sh', 'pretool.sh', 'prompt-inject.sh'] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_SOURCE_DIR = resolve(HERE, 'scripts');
const REPO_ROOT = findRepoRoot(HERE);
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
// MCP bridge lives next to us in packages/core/src/mcp/.
const MCP_BRIDGE_ENTRY = resolve(HERE, '..', 'mcp', 'bridge.ts');

export type ScriptName = (typeof SCRIPT_FILES)[number];

export interface WorkspacePaths {
  cwd: string;
  workspaceDir: string;
  hooksDir: string;
  settingsPath: string;
  mcpConfigPath: string;
  scripts: Record<ScriptName, string>;
}

export function workspacePaths(cwd: string): WorkspacePaths {
  const workspaceDir = join(cwd, '.selfclaude');
  const hooksDir = join(workspaceDir, 'hooks');
  const settingsPath = join(workspaceDir, 'settings.json');
  const mcpConfigPath = join(workspaceDir, 'mcp-config.json');
  const scripts = Object.fromEntries(
    SCRIPT_FILES.map((f) => [f, join(hooksDir, f)] as const),
  ) as Record<ScriptName, string>;
  return { cwd, workspaceDir, hooksDir, settingsPath, mcpConfigPath, scripts };
}

/**
 * Initialize the target project's `.selfclaude/` workspace.
 *
 * Copies our hook scripts into `<cwd>/.selfclaude/hooks/` and writes a
 * standalone `settings.json`. The CLI passes that file via `claude --settings`
 * so the user's own `.claude/settings.local.json` stays untouched.
 */
export async function installWorkspace(cwd: string): Promise<WorkspacePaths> {
  const paths = workspacePaths(cwd);
  await mkdir(paths.hooksDir, { recursive: true });

  for (const file of SCRIPT_FILES) {
    const dest = paths.scripts[file];
    await copyFile(join(SCRIPTS_SOURCE_DIR, file), dest);
    await chmod(dest, 0o755);
  }

  const settings = {
    hooks: {
      Stop: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: paths.scripts['stop.sh'] }],
        },
      ],
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: paths.scripts['pretool.sh'] }],
        },
      ],
      UserPromptSubmit: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: paths.scripts['prompt-inject.sh'] }],
        },
      ],
    },
  };
  await writeFile(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const mcpConfig = {
    mcpServers: {
      selfclaude: {
        command: TSX_BIN,
        args: [MCP_BRIDGE_ENTRY],
      },
    },
  };
  await writeFile(paths.mcpConfigPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);

  log('info', 'workspace.installed', { workspaceDir: paths.workspaceDir });
  return paths;
}
