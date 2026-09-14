import { fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createTelegramIntegrationConfig,
  deriveTelegramWebhookSecret,
  safeWebhookResponse,
} from "@/lib/security/telegram-webhook";

/**
 * POST /api/telegram/connect
 *
 * Connects a Dispatch agent to a Telegram bot. The user creates a
 * bot via @BotFather, pastes the token here, and we:
 *
 *   1. Validate the token by calling Telegram `getMe`
 *   2. Register the per-agent webhook URL via `setWebhook`
 *   3. Store the bot token in `agentIntegrations`
 *
 * The webhook URL is derived from the request origin:
 *   `https://<domain>/api/webhooks/telegram/<agentId>`
 *
 * Auth: Convex Auth (the user must own the agent).
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { agentId, botToken } = body as {
    agentId?: string;
    botToken?: string;
  };

  if (!agentId || !botToken) {
    return Response.json(
      { error: "agentId and botToken are required" },
      { status: 400 },
    );
  }

  // 1. Validate the token by calling getMe
  let botUsername: string;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getMe`,
    );
    const data = await res.json();
    if (!data.ok) {
      return Response.json(
        { error: `Invalid bot token: ${data.description ?? "unknown error"}` },
        { status: 400 },
      );
    }
    botUsername = data.result.username ?? "unknown";
  } catch (err) {
    return Response.json(
      {
        error: `Failed to validate bot token: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  // 2. Register the webhook with Telegram.
  // Telegram requires HTTPS — on localhost, use NEXT_PUBLIC_APP_URL or
  // VERCEL_PROJECT_PRODUCTION_URL so the webhook points at the deployed
  // instance instead of http://localhost:3000.
  const requestOrigin = new URL(request.url).origin;
  const productionUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);
  const origin =
    requestOrigin.startsWith("https://") ? requestOrigin : productionUrl;

  if (!origin) {
    return Response.json(
      {
        error:
          "Telegram requires HTTPS. Set NEXT_PUBLIC_APP_URL to your deployed URL (e.g. https://app.dispatch.com) to connect from localhost.",
      },
      { status: 400 },
    );
  }

  // Append Vercel's deployment protection bypass secret as a query
  // param so Telegram's webhook requests pass through preview-auth.
  // Production deployments don't have preview-auth, so the param is
  // harmless there — it's simply ignored.
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const bypassParam = bypassSecret
    ? `?x-vercel-protection-bypass=${bypassSecret}`
    : "";
  const webhookUrl = `${origin}/api/webhooks/telegram/${agentId}${bypassParam}`;
  const webhookMasterSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookMasterSecret) {
    return Response.json(
      { error: "Telegram webhook authentication is not configured" },
      { status: 503 },
    );
  }
  const webhookSecret = deriveTelegramWebhookSecret(agentId, webhookMasterSecret);

  // Persist the secret before registration because Telegram may deliver an
  // update immediately after setWebhook succeeds.
  try {
    await fetchAuthMutation(api.integrations.upsert, {
      agentId: agentId as Id<"agents">,
      platform: "telegram",
      encryptedConfig: createTelegramIntegrationConfig(botToken, webhookSecret),
      channelBinding: `tg:@${botUsername}`,
    });
  } catch (err) {
    return Response.json(
      { error: `Failed to save integration: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: [
            "message",
            "callback_query",
            "my_chat_member",
          ],
        }),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      return Response.json(
        {
          error: `Failed to register webhook: ${data.description ?? "unknown"}`,
        },
        { status: 500 },
      );
    }
  } catch (err) {
    return Response.json(
      {
        error: `Failed to register webhook: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  console.log(
    `[telegram:connect] Connected agent ${agentId.slice(0, 8)}... to @${botUsername}`,
  );

  return Response.json(safeWebhookResponse(botUsername));
}
