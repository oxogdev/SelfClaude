import { Bot } from 'grammy';
import type { IncomingMessage, TelegramAdapter } from './adapter.js';
import { log } from '../lib/log.js';

/**
 * Production Telegram adapter — wraps a grammY long-poll Bot. Filters incoming
 * messages by chat id so other Telegram chats can't drive the orchestrator.
 */
export class GrammyTelegramAdapter implements TelegramAdapter {
  private readonly bot: Bot;
  private startedPromise: Promise<void> | null = null;

  constructor(
    private readonly token: string,
    private readonly chatId: string,
  ) {
    this.bot = new Bot(this.token);
  }

  async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    this.bot.on('message:text', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      await onMessage({
        text: ctx.message.text,
        replyToMessageId: ctx.message.reply_to_message?.message_id,
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.startedPromise = this.bot
        .start({
          onStart: () => {
            log('info', 'telegram.bot_started');
            resolve();
          },
          drop_pending_updates: true,
        })
        .catch((e) => {
          log('error', 'telegram.bot_died', { reason: String(e) });
          reject(e);
        });
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    if (this.startedPromise) {
      await this.startedPromise.catch(() => undefined);
      this.startedPromise = null;
    }
  }

  async send(text: string): Promise<number> {
    const msg = await this.bot.api.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
    return msg.message_id;
  }

  async getMe(): Promise<{ username: string | undefined }> {
    const me = await this.bot.api.getMe();
    return { username: me.username };
  }
}
