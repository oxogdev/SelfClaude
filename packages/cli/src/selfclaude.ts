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
  .description('Start the orchestrator in the current working directory')
  .option('--demo', 'Render the TUI with synthetic events (no real claude subprocess)')
  .option('--tui', 'Use the legacy Ink TUI instead of the (upcoming) web UI')
  .option('--cwd <dir>', 'Working directory the orchestrator operates in')
  .action(async (opts: { demo?: boolean; tui?: boolean; cwd?: string }) => {
    if (opts.demo) {
      const { startDemo } = await import('@selfclaude/tui');
      await startDemo();
      return;
    }

    // For now, all non-demo flows still run the legacy TUI. The web UI lands
    // in Phase C; this branch will switch to launching the WebAPI + browser
    // when --tui is omitted. `--tui` will remain as the explicit fallback.
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
  });

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
