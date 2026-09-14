import "server-only";

import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Chat } from "chat";

import { createBoundHandlers } from "@/lib/chat/handlers/message";
import { createConvexState } from "@/lib/chat/state/convex-state-adapter";
import { BOT_NAME } from "@/lib/config/branding";
import type { ResolvedAgent } from "@/lib/chat/routing/resolve-agent";

/**
 * Per-agent Telegram Chat instance cache.
 *
 * Unlike Slack (one global bot, multi-workspace via OAuth + channel
 * binding), Telegram requires one bot token per agent. Each agent
 * gets its own Chat SDK instance with its own TelegramAdapter. The
 * instances are cached per Vercel warm function so we don't re-create
 * them on every webhook — but each warm instance may hold multiple
 * bots if it serves webhooks for different agents.
 *
 * The handlers are pre-bound to the agent via `createBoundHandlers`,
 * so the binding-key resolution step (which would fail for Telegram
 * since there's no pre-registered channel binding) is skipped entirely.
 */

type CachedBot = {
  bot: Chat;
  /** The bot token this instance was created with. If the token changes (re-connect), we recreate. */
  botToken: string;
};

const cache = new Map<string, CachedBot>();

/**
 * Get or create a Chat SDK instance for a specific agent's Telegram bot.
 *
 * The instance is cached by agentId. If the bot token changes (user
 * reconnected with a different BotFather token), the old instance is
 * discarded and a new one is created.
 */
export function getTelegramBot(
  agentId: string,
  botToken: string,
  agentInfo: ResolvedAgent,
): Chat {
  const existing = cache.get(agentId);
  if (existing && existing.botToken === botToken) {
    return existing.bot;
  }

  const bot = new Chat({
    userName: BOT_NAME,
    adapters: {
      telegram: createTelegramAdapter({
        botToken,
        mode: "webhook",
      }),
    },
    state: createConvexState(),
    concurrency: {
      strategy: "queue",
      maxQueueSize: 10,
      queueEntryTtlMs: 900_000,
    },
    dedupeTtlMs: 900_000,
    fallbackStreamingPlaceholderText: "Thinking\u2026",
    logger: "info",
  });

  // Register handlers pre-bound to this agent — skips binding resolution.
  const handlers = createBoundHandlers(agentInfo);
  bot.onNewMention(handlers.handleMention);
  bot.onSubscribedMessage(handlers.handleSubscribed);
  bot.onDirectMessage(handlers.handleDM);

  cache.set(agentId, { bot, botToken });
  return bot;
}
