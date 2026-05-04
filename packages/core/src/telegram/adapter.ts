/**
 * Transport-agnostic Telegram interface. The bridge talks to this; tests
 * substitute a fake implementation that records sends and lets the test
 * harness simulate incoming replies. The production adapter wraps grammY.
 */

export interface IncomingMessage {
  text: string;
  /** Telegram message_id of the bot message this is a reply to, if any. */
  replyToMessageId?: number;
}

export interface TelegramAdapter {
  /** Begin handling incoming messages. The handler is invoked for every text message. */
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Send a text message; returns the new message_id (used to map replies back). */
  send(text: string): Promise<number>;
}
