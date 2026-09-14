import { after } from "next/server";
import { fetchQuery, fetchMutation } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getSecret } from "@/lib/chat/secrets";
import { getTelegramBot } from "@/lib/chat/telegram-bots";
import {
  parseTelegramIntegrationConfig,
  deriveTelegramWebhookSecret,
  verifyTelegramWebhookSecret,
} from "@/lib/security/telegram-webhook";

/**
 * POST /api/webhooks/telegram/[agentId]
 *
 * Per-agent Telegram webhook endpoint. Each Dispatch agent that's
 * connected to Telegram gets its own webhook URL. When the user
 * connects via the manage page, we call Telegram's `setWebhook` with
 * this URL. All updates for that bot arrive here.
 *
 * Flow:
 *   1. Extract agentId from the URL
 *   2. Look up the bot token + agent runtime info from Convex
 *   3. Get or create a cached Chat SDK instance for this agent
 *   4. Forward the request to the Chat SDK webhook handler
 *
 * This is the Telegram equivalent of `/api/webhooks/[platform]` for
 * Slack, but per-agent because each agent has its own bot token.
 */
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  console.log(`[telegram:webhook] POST /api/webhooks/telegram/${agentId.slice(0, 8)}...`);

  const webhookMasterSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!webhookMasterSecret) {
    return Response.json({ error: "Webhook authentication unavailable" }, { status: 503 });
  }
  const expectedSecret = deriveTelegramWebhookSecret(agentId, webhookMasterSecret);
  if (!verifyTelegramWebhookSecret(suppliedSecret, expectedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Look up integration config (bot token + agent info)
  const config = await fetchQuery(api.integrations.getConfigInternal, {
    agentId: agentId as Id<"agents">,
    platform: "telegram",
    secret: getSecret(),
  });

  if (!config || !config.encryptedConfig) {
    console.error(`[telegram:webhook] No Telegram integration for agent ${agentId.slice(0, 8)}`);
    return Response.json(
      { error: "No Telegram integration found for this agent" },
      { status: 404 },
    );
  }

  const telegramConfig = parseTelegramIntegrationConfig(config.encryptedConfig);
  if (
    !telegramConfig ||
    !verifyTelegramWebhookSecret(expectedSecret, telegramConfig.webhookSecret)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!config.sandboxId || !config.serverPassword) {
    console.error(`[telegram:webhook] Agent ${agentId.slice(0, 8)} not provisioned`);
    return Response.json(
      { error: "Agent not provisioned" },
      { status: 400 },
    );
  }

  // 2. Get or create the cached Chat instance
  const bot = getTelegramBot(agentId, telegramConfig.botToken, {
    agentId: config.agentId,
    agentName: config.agentName,
    userId: config.userId,
    sandboxId: config.sandboxId,
    serverPassword: config.serverPassword,
    toolPermissions: config.toolPermissions,
    composioToolkits: config.composioToolkits,
    encryptedConfig: telegramConfig.botToken,
  });

  // 3. Extract chat info from the Telegram update so the delivery
  //    picker can show a dropdown of known chats (instead of manual ID input).
  //    We clone the body before Chat SDK consumes it.
  try {
    const body = await request.clone().json();
    const msg = body.message ?? body.channel_post ?? body.edited_message;
    if (msg?.chat) {
      const chat = msg.chat;
      const chatTitle =
        chat.title ?? // groups/channels have title
        [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? // private chats
        String(chat.id);
      const chatType: string = chat.type ?? "private";

      // Store in chatState as a key-value entry. Each chat gets its own
      // key so we naturally dedupe. The delivery picker reads all keys
      // matching the prefix `telegram:chat:{agentId}:*`.
      after(async () => {
        try {
          await fetchMutation(api.chatState.set, {
            key: `telegram:chat:${agentId}:${chat.id}`,
            value: { chatId: chat.id, title: chatTitle, type: chatType },
            secret: getSecret(),
          });
        } catch {
          // Non-critical — don't break the webhook
        }
      });
    }
  } catch {
    // Body parse failed — not a standard message update, skip extraction
  }

  // 4. Forward to Chat SDK's Telegram webhook handler
  const handler = bot.webhooks.telegram;
  if (!handler) {
    return Response.json(
      { error: "Telegram adapter not available" },
      { status: 500 },
    );
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}
