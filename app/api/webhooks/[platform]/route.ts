import { after } from "next/server";

import { bot } from "@/lib/chat/bot";

/**
 * Universal Chat SDK webhook entry point.
 *
 * One dynamic route handles every platform Chat SDK is configured
 * for. Slack POSTs to `/api/webhooks/slack`, Telegram (when added)
 * POSTs to `/api/webhooks/telegram`, etc. — and the same handler
 * dispatches to `bot.webhooks[platform]`. Adding a new platform
 * never requires a new file in `app/api/webhooks/` — it's a config
 * change in `lib/chat/bot.ts`.
 *
 * The `waitUntil` + `next/server.after` pattern is **mandatory** for
 * Slack and similar platforms with strict ack windows: Slack
 * requires a 200 response within 3 seconds but the OpenCode stream
 * routinely takes longer. The webhook handler returns the response
 * immediately, and the actual handler work continues in `after()`.
 * Vercel keeps the function alive until the deferred work completes.
 *
 * `maxDuration = 300` keeps the default deployment compatible with
 * Vercel Hobby. Phase 4 will move the long-running portion to Vercel
 * Workflow durable execution; until then, this is the portable cap.
 */

export const maxDuration = 300;

type Platform = keyof typeof bot.webhooks;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  console.log(`[chat-sdk:webhook] POST /api/webhooks/${platform}`);

  const handler = bot.webhooks[platform as Platform];
  if (!handler) {
    console.error(
      `[chat-sdk:webhook] Unknown platform "${platform}" — check lib/chat/bot.ts adapters map`,
    );
    return new Response(`Unknown chat platform: ${platform}`, {
      status: 404,
    });
  }

  return handler(request, {
    waitUntil: (task) => after(() => task),
  });
}

// Some Slack URL verification flows use GET; respond cleanly so the
// platform's setup wizard doesn't show a 405 noise error.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  return Response.json({ ok: true, platform });
}
