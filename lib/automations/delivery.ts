/**
 * Output delivery handlers.
 *
 * Routes automation output to the right destination. Uses the shared
 * slack-api.ts wrapper for Slack and direct Bot API for Telegram.
 */
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { postInThread } from "./triggers/slack-api";

function getChatStateSecret(): string {
  return process.env.CHAT_STATE_INTERNAL_SECRET ?? "";
}

export type DeliveryConfig = {
  type: string;
  config?: unknown;
};

export async function deliverOutput(params: {
  output: string;
  delivery: DeliveryConfig;
  automation: { name: string };
}): Promise<void> {
  const { output, delivery } = params;

  switch (delivery.type) {
    case "activity_log":
      return;

    case "slack_channel": {
      // The DeliveryPicker saves `channelBinding` (e.g. "team:T123" or
      // "chan:C456"). Parse it to extract teamId for token lookup.
      // Also accept explicit teamId/channelId for backwards compat.
      const config = delivery.config as {
        channelBinding?: string;
        teamId?: string;
        channelId?: string;
      };

      let teamId = config.teamId;
      let channelId = config.channelId;

      if (config.channelBinding) {
        const binding = config.channelBinding;
        if (binding.startsWith("team:")) {
          teamId = binding.replace("team:", "");
        } else if (binding.startsWith("chan:")) {
          channelId = binding.replace("chan:", "");
        }
      }

      if (!teamId) {
        // If we only have a channel ID, we can't look up the bot token.
        // Log and skip instead of crashing.
        console.warn("[delivery] No teamId for Slack delivery, skipping. Config:", config);
        return;
      }

      const token = await getSlackBotToken(teamId);
      if (!token) {
        console.warn(`[delivery] No Slack bot token for team ${teamId}`);
        return;
      }

      // If we have a specific channel, post there. Otherwise the bot
      // token is workspace-wide but we don't know WHERE to post.
      if (channelId) {
        const result = await postInThread(token, channelId, null, output);
        if (!result.ok) console.warn(`[delivery] Slack post failed: ${result.error.kind}`);
      } else {
        console.warn("[delivery] Slack delivery configured but no channelId — can't determine where to post");
      }
      return;
    }

    case "slack_thread": {
      const { teamId, channelId, threadTs } = delivery.config as {
        teamId: string;
        channelId: string;
        threadTs: string;
      };
      const token = await getSlackBotToken(teamId);
      if (!token) throw new Error(`No Slack bot token for team ${teamId}`);
      const result = await postInThread(token, channelId, threadTs, output);
      if (!result.ok) throw new Error(`Slack delivery failed: ${result.error.kind}`);
      return;
    }

    case "telegram_channel": {
      const config = delivery.config as {
        agentId?: string;
        chatId?: string | number;
      };

      if (!config.agentId) {
        console.warn("[delivery] Telegram delivery configured but no agentId in config");
        return;
      }

      // Get the bot token from the agent's Telegram integration
      const botToken = await getTelegramBotToken(config.agentId as Id<"agents">);
      if (!botToken) {
        console.warn(`[delivery] No Telegram bot token for agent ${config.agentId}`);
        return;
      }

      if (!config.chatId) {
        console.warn("[delivery] Telegram delivery configured but no chatId — can't determine where to post");
        return;
      }

      const result = await postToTelegram(botToken, config.chatId, output);
      if (!result.ok) {
        console.warn(`[delivery] Telegram post failed: ${result.error}`);
      }
      return;
    }

    default:
      console.warn(`[delivery] unknown delivery type: ${delivery.type}`);
      return;
  }
}

async function getSlackBotToken(teamId: string): Promise<string | null> {
  try {
    const result = await fetchQuery(api.chatState.get, {
      key: `slack:installation:${teamId}`,
      secret: getChatStateSecret(),
    });
    if (!result?.value) return null;
    return (result.value as { botToken?: string }).botToken ?? null;
  } catch {
    return null;
  }
}

async function getTelegramBotToken(agentId: Id<"agents">): Promise<string | null> {
  try {
    const secret = process.env.CRON_INTERNAL_SECRET ?? "";
    const result = await fetchQuery(api.integrations.getConfigInternal, {
      agentId,
      platform: "telegram",
      secret,
    });
    const { parseTelegramIntegrationConfig } = await import("@/lib/security/telegram-webhook");
    return result?.encryptedConfig
      ? parseTelegramIntegrationConfig(result.encryptedConfig)?.botToken ?? null
      : null;
  } catch {
    return null;
  }
}

async function postToTelegram(
  botToken: string,
  chatId: string | number,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Telegram has a 4096 char limit per message. Split if needed.
    const chunks = splitTelegramMessage(text, 4096);

    for (const chunk of chunks) {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            parse_mode: "Markdown",
          }),
        },
      );

      const data = await res.json();
      if (!data.ok) {
        // Retry without Markdown if parsing fails
        if (data.description?.includes("parse")) {
          const retry = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: chunk }),
            },
          );
          const retryData = await retry.json();
          if (!retryData.ok) {
            return { ok: false, error: retryData.description ?? "Send failed" };
          }
        } else {
          return { ok: false, error: data.description ?? "Send failed" };
        }
      }
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function splitTelegramMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline boundary
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
