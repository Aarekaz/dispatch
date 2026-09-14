import { fetchMutation, fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { ensureBotInitialized, getSlackAdapter } from "@/lib/chat/bot";
import { getSecret } from "@/lib/chat/secrets";
import { getToken } from "@/lib/auth-server";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * GET /api/slack/callback?code=<code>&state=<csrf>
 *
 * Completes the Slack OAuth install flow. **Does not yet bind the
 * agent to anything** — the binding happens on the picker page after
 * the customer chooses workspace-wide vs specific channels.
 *
 * Flow:
 *   1. Validate the CSRF token in `state` against `chatKv`. The
 *      install route stored `slack:install:<csrf> = <agentId>`
 *      with a 10-minute TTL.
 *   2. Read the agentId from chatKv, then delete the CSRF row
 *      so it cannot be replayed.
 *   3. Hand the request to `slackAdapter.handleOAuthCallback()`,
 *      which extracts the `code`, exchanges it via Slack's
 *      `oauth.v2.access` API, and persists the workspace
 *      installation through our state adapter (under the
 *      `slack:installation:{teamId}` key in `chatKv`).
 *   4. Redirect the user to the channel picker at
 *      `/manage/<agentId>/slack-pick?teamId=<id>&teamName=<name>`.
 *      The picker page lists the workspace's channels and lets the
 *      customer choose workspace-wide or specific channels — the
 *      `agentIntegrations` row is created at submit time, not here.
 *
 * Errors at any step are surfaced as a plain-text response so the
 * user sees them in the browser tab — never silent.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const csrf = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // The user clicked "Cancel" in Slack's OAuth screen.
  if (error) {
    return new Response(`Slack install canceled: ${error}`, { status: 400 });
  }

  if (!code || !csrf) {
    return new Response("Missing code or state from Slack callback", {
      status: 400,
    });
  }

  // 1. CSRF check + agentId lookup.
  const cacheKey = `slack:install:${csrf}`;
  const installState = await fetchQuery(api.chatState.get, {
    key: cacheKey,
    secret: getSecret(),
  });
  if (
    !installState ||
    typeof installState !== "object" ||
    !("agentId" in installState) ||
    !("userId" in installState)
  ) {
    return new Response(
      "Install link expired or invalid. Click + Slack again on your agent page.",
      { status: 400 },
    );
  }
  const { agentId, userId } = installState as { agentId: string; userId: string };
  const token = await getToken();
  if (!token) return new Response("Unauthorized", { status: 401 });
  const [agent, currentUser] = await Promise.all([
    fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token }),
    fetchQuery(api.users.me, {}, { token }),
  ]);
  if (!agent || currentUser?.id !== userId) {
    return new Response("Install link does not belong to this account", { status: 403 });
  }

  // 2. One-time use — delete the CSRF row immediately so it can't
  // be replayed even if the rest of the callback fails.
  await fetchMutation(api.chatState.deleteKey, {
    key: cacheKey,
    secret: getSecret(),
  });

  // 3. Let Chat SDK do the code exchange + setInstallation. This
  // call:
  //   - POSTs to https://slack.com/api/oauth.v2.access
  //   - Receives { team: { id, name }, access_token, bot_user_id, ... }
  //   - Calls slackAdapter.setInstallation(teamId, { botToken, ... })
  //     which writes through our Convex state adapter under
  //     `slack:installation:{teamId}` in chatKv
  //   - Returns { teamId, installation }
  let teamId: string;
  let teamName: string | undefined;
  try {
    // Chat SDK lazy-inits on the first webhook; we're bypassing that
    // path by calling the adapter directly, so ensure init explicitly.
    await ensureBotInitialized();
    const slack = getSlackAdapter();
    const result = await slack.handleOAuthCallback(request);
    teamId = result.teamId;
    teamName = result.installation.teamName;
    await fetchMutation(api.chatState.set, {
      key: `slack:owner:${teamId}:${userId}`,
      value: true,
      secret: getSecret(),
    });
  } catch (err) {
    console.error("[chat-sdk:slack-callback] handleOAuthCallback failed:", err);
    return new Response(
      `Couldn't complete Slack install: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { status: 500 },
    );
  }

  console.log(
    `[chat-sdk:slack-callback] installed agentId=${agentId.slice(0, 8)}... into workspace ${teamId} (${teamName ?? "unnamed"})`,
  );

  // 4. Redirect to the picker page so the customer can choose
  // workspace-wide vs specific channels. The teamId/teamName are
  // passed via query string — they're not secrets, just identifiers.
  const pickUrl = new URL(`/manage/${agentId}/slack-pick`, url.origin);
  pickUrl.searchParams.set("teamId", teamId);
  if (teamName) pickUrl.searchParams.set("teamName", teamName);
  return Response.redirect(pickUrl.toString(), 302);
}
