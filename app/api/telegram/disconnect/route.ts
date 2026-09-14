import { fetchAuthMutation, fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseTelegramIntegrationConfig } from "@/lib/security/telegram-webhook";

/**
 * POST /api/telegram/disconnect
 *
 * Disconnects a Dispatch agent from its Telegram bot:
 *   1. Look up the integration to get the bot token
 *   2. Call Telegram `deleteWebhook` to stop updates
 *   3. Remove the integration row from Convex
 *
 * Auth: Convex Auth (the user must own the agent).
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { agentId } = body as { agentId?: string };

  if (!agentId) {
    return Response.json(
      { error: "agentId is required" },
      { status: 400 },
    );
  }

  // 1. Look up existing integrations for this agent
  const integrations = await fetchAuthQuery(
    api.integrations.list,
    { agentId: agentId as Id<"agents"> },
  );

  const telegramIntegration = integrations.find(
    (i) => i.platform === "telegram",
  );

  if (!telegramIntegration) {
    return Response.json(
      { error: "No Telegram integration found for this agent" },
      { status: 404 },
    );
  }

  // 2. Get the bot token to call deleteWebhook. We need the internal
  // query since `list` strips encryptedConfig.
  const secret = process.env.CHAT_STATE_INTERNAL_SECRET ?? "";
  const config = await fetchQuery(api.integrations.getConfigInternal, {
    agentId: agentId as Id<"agents">,
    platform: "telegram",
    secret,
  });

  if (config?.encryptedConfig) {
    const telegramConfig = parseTelegramIntegrationConfig(config.encryptedConfig);
    try {
      if (!telegramConfig) throw new Error("Telegram integration must be reconnected");
      const res = await fetch(
        `https://api.telegram.org/bot${telegramConfig.botToken}/deleteWebhook`,
      );
      const data = await res.json();
      console.log(
        `[telegram:disconnect] deleteWebhook for agent ${agentId.slice(0, 8)}...: ${data.ok ? "ok" : data.description}`,
      );
    } catch (err) {
      // Non-fatal: even if deleteWebhook fails (e.g. token was already
      // revoked), we still remove the integration record so the UI
      // reflects the disconnected state.
      console.warn(
        `[telegram:disconnect] deleteWebhook failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 3. Remove the integration
  try {
    await fetchAuthMutation(
      api.integrations.remove,
      { id: telegramIntegration.id },
    );
  } catch (err) {
    return Response.json(
      {
        error: `Failed to remove integration: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  console.log(
    `[telegram:disconnect] Disconnected agent ${agentId.slice(0, 8)}...`,
  );

  return Response.json({ ok: true });
}
