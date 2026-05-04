#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command } from 'commander';

const program = new Command();

program
  .name('selfclaude')
  .description('Two-agent Claude Code orchestration')
  .version('0.0.1');

program
  .command('start', { isDefault: true })
  .description('Start the orchestrator (web UI by default; legacy TUI via --tui)')
  .option('--demo', 'Render the legacy TUI with synthetic events (no real claude subprocess)')
  .option('--tui', 'Use the legacy Ink TUI instead of the web UI')
  .option('--web', 'Force web UI (default when --tui/--demo are absent)')
  .option('--no-open', "Don't auto-open the browser when starting in web mode")
  .option('--port <port>', 'Web API port (web mode only)', '7423')
  .option('--web-port <port>', 'Next.js dev server port (web mode only)', '3000')
  .option('--cwd <dir>', 'Working directory the orchestrator operates in (TUI mode only)')
  .action(
    async (opts: {
      demo?: boolean;
      tui?: boolean;
      web?: boolean;
      open?: boolean;
      port?: string;
      webPort?: string;
      cwd?: string;
    }) => {
      if (opts.demo) {
        const { startDemo } = await import('@selfclaude/tui');
        await startDemo();
        return;
      }

      // Default to web UI; --tui is the explicit legacy fallback.
      if (!opts.tui) {
        await runWebMode({
          apiPort: Number(opts.port ?? 7423),
          nextPort: Number(opts.webPort ?? 3000),
          openBrowser: opts.open !== false,
        });
        return;
      }

      const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
    const {
      Orchestrator,
      TelegramBridge,
      GrammyTelegramAdapter,
      loadEnv,
      hasTelegram,
    } = await import('@selfclaude/core');
    const { startInteractive } = await import('@selfclaude/tui');

    const orch = new Orchestrator({ cwd });
    const env = loadEnv();
    let bridge: InstanceType<typeof TelegramBridge> | null = null;

    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        if (bridge) await bridge.stop();
      } catch {
        /* ignore */
      }
      try {
        await orch.stop();
      } catch {
        /* ignore */
      }
    };
    process.on('SIGINT', () => {
      void stop().then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      void stop().then(() => process.exit(0));
    });

    const startResult = await orch.start();

    if (hasTelegram(env)) {
      const adapter = new GrammyTelegramAdapter(env.TELEGRAM_BOT_TOKEN!, env.TELEGRAM_CHAT_ID!);
      bridge = new TelegramBridge({ orchestrator: orch, adapter });
      await bridge.start();
    }

    try {
      await startInteractive(orch, startResult);
    } finally {
      await stop();
    }
    },
  );

async function runWebMode(opts: {
  apiPort: number;
  nextPort: number;
  openBrowser: boolean;
}): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve: pathResolve } = await import('node:path');
  const { findRepoRoot, startWebApi } = await import('@selfclaude/core');

  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO_ROOT = findRepoRoot(HERE);
  const WEB_DIR = pathResolve(REPO_ROOT, 'packages', 'web');
  const NEXT_BIN = pathResolve(WEB_DIR, 'node_modules', '.bin', 'next');

  const api = await startWebApi({ port: opts.apiPort });
  console.log(`✓ SelfClaude Web API: ${api.url}`);

  const nextProc = spawn(NEXT_BIN, ['dev', '--port', String(opts.nextPort)], {
    stdio: 'inherit',
    cwd: WEB_DIR,
  });

  const browserUrl = `http://127.0.0.1:${opts.nextPort}/`;
  if (opts.openBrowser) {
    setTimeout(() => {
      try {
        spawn('open', [browserUrl], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        /* best effort */
      }
    }, 3500);
  }
  console.log(`✓ Web UI: ${browserUrl}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      nextProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    try {
      await api.server.close();
    } catch {
      /* ignore */
    }
    try {
      await api.manager.destroyAll();
    } catch {
      /* ignore */
    }
  };
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(0));
  });
  nextProc.on('exit', (code) => {
    void stop().then(() => process.exit(code ?? 0));
  });
}

program
  .command('link-telegram')
  .description('Pair a Telegram chat with this SelfClaude install (auto-discovers TELEGRAM_CHAT_ID)')
  .action(async () => {
    const { loadEnv, runLinkFlow } = await import('@selfclaude/core');
    const env = loadEnv();
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN must be set in .env first.');
      process.exit(1);
    }
    try {
      await runLinkFlow(env.TELEGRAM_BOT_TOKEN);
    } catch (e) {
      console.error(`link failed: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check environment and Telegram connectivity')
  .action(async () => {
    const { loadEnv, GrammyTelegramAdapter } = await import('@selfclaude/core');
    const env = loadEnv();
    console.log('--- environment ---');
    console.log(`TELEGRAM_BOT_TOKEN: ${env.TELEGRAM_BOT_TOKEN ? 'set' : 'unset'}`);
    console.log(`TELEGRAM_CHAT_ID:   ${env.TELEGRAM_CHAT_ID ? 'set' : 'unset'}`);
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.log('Telegram bridge: disabled (set TELEGRAM_BOT_TOKEN in .env to enable).');
      return;
    }
    if (!env.TELEGRAM_CHAT_ID) {
      console.log('Telegram bridge: token set, chat unpaired.');
      console.log('  → run `selfclaude link-telegram` to pair a chat with this install.');
      return;
    }
    const adapter = new GrammyTelegramAdapter(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID);
    try {
      const me = await adapter.getMe();
      console.log(`Telegram bot: reachable (@${me.username ?? '?'})`);
    } catch (e) {
      console.log(`Telegram bot: unreachable — ${(e as Error).message}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
