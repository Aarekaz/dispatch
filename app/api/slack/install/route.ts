import { fetchMutation } from "convex/nextjs";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { getSecret } from "@/lib/chat/secrets";
import { getToken } from "@/lib/auth-server";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * GET /api/slack/install?agentId=<id>
 *
 * Starts the Slack OAuth install flow for a specific agent.
 *
 * Flow:
 *   1. Read `agentId` from the query string.
 *   2. Generate a CSRF token (random UUID).
 *   3. Store `slack:install:<csrf> = <agentId>` in the Convex
 *      `chatKv` table with a 10-minute TTL via `chatState.set`.
 *      The TTL is the only thing protecting against an abandoned
 *      install — we never want a stale CSRF to bind a wrong agent.
 *   4. Redirect to Slack's OAuth authorize URL with the CSRF token
 *      as the `state` parameter. Slack echoes it back on callback.
 *
 * The callback at `/api/slack/callback` looks up the CSRF in
 * `chatKv`, retrieves the agentId, and binds the workspace.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");

  if (!agentId) {
    return new Response("Missing agentId query parameter", { status: 400 });
  }

  const token = await getToken();
  if (!token) return new Response("Unauthorized", { status: 401 });
  const [agent, user] = await Promise.all([
    fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token }),
    fetchQuery(api.users.me, {}, { token }),
  ]);
  if (!agent || !user) return new Response("Agent not found", { status: 404 });

  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return new Response(
      "Slack OAuth not configured: SLACK_CLIENT_ID and SLACK_REDIRECT_URI must be set in .env.local",
      { status: 500 },
    );
  }

  // Generate a one-time CSRF token. The Web Crypto `randomUUID` is
  // available globally on Node 19+ and on Vercel runtimes.
  const csrf = crypto.randomUUID();

  // Persist the CSRF → agentId mapping for the callback to read.
  // 10-minute TTL is plenty for the OAuth roundtrip; even on slow
  // networks the user authorizes within seconds.
  await fetchMutation(api.chatState.set, {
    key: `slack:install:${csrf}`,
    value: { agentId, userId: user.id },
    ttlMs: 10 * 60 * 1000,
    secret: getSecret(),
  });

  // Build the Slack OAuth authorize URL.
  //
  // **Scopes MUST match `lib/chat/bot.ts`'s manifest comment block.**
  // That file documents every scope + event the runtime expects,
  // including a long warning about why `message.channels` /
  // `message.groups` must NOT be subscribed (they race with
  // `app_mention` and silently break channel @-mentions). Keep this
  // list in sync with the "oauth_config.scopes.bot" list over there.
  //
  // `assistant:write` is required by Chat SDK's native Slack
  // streaming path (`chat.startStream` / `chat.stopStream` in
  // @slack/web-api) — without it, every streaming response fails
  // with `not_authed` when the streamer tries to finalize.
  //
  // `app_mentions:read` is what makes `app_mention` events flow —
  // which is the ONLY way Chat SDK detects mentions (the adapter
  // checks `event.type === "app_mention"` at
  // `node_modules/@chat-adapter/slack/dist/index.js:1487`).
  // `search:read.public` is the Feb 2026 granular Search scope. It
  // lets the bot token call `search.messages` so the agent can
  // answer "find the conversation from last week about X" via
  // bash+curl (see `buildBootstrapPrompt` — the Slack capability
  // block). Adding this scope means existing Slack installs need
  // to REINSTALL to grant it; without it, `search.messages` fails
  // with `missing_scope` and the agent tells the user to reinstall.
  const scopes = [
    "app_mentions:read",
    "assistant:write",
    "channels:history",
    "channels:read",
    "chat:write",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "reactions:read",
    "reactions:write",
    "search:read.public",
    "users:read",
  ].join(",");

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("user_scope", "");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", csrf);

  console.log(
    `[chat-sdk:slack-install] redirecting agentId=${agentId.slice(0, 8)}... to Slack OAuth`,
  );

  return Response.redirect(authorizeUrl.toString(), 302);
}
