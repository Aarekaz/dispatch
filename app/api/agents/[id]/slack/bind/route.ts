import { fetchAuthMutation, fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getSecret } from "@/lib/chat/secrets";
import { listBotChannels } from "@/lib/automations/triggers/slack-api";

/**
 * POST /api/agents/[id]/slack/bind
 *
 * Body shape:
 *   { scope: "workspace", teamId: string }
 *   { scope: "channels", teamId: string, channelIds: string[] }
 *
 * Binds an agent to a Slack workspace or set of channels. Called
 * by the picker form on `/manage/[id]/slack-pick` after the user
 * makes their choice.
 *
 * **Auth:** Better Auth required. The token is read from the
 * request cookies via `isAuthenticated()` / `fetchAuthMutation()`.
 * The actual agent-ownership check happens inside
 * `api.integrations.bindAgent`, which uses `requireUserId(ctx)`
 * against the same Better Auth identity.
 *
 * **Collision prevention:** delegated to the Convex mutation —
 * `bindAgent` throws clear errors if the requested binding would
 * collide with another agent's existing binding (workspace-wide
 * or per-channel).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // 1. Auth.
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse + validate body.
  let body: BindBody;
  try {
    body = (await request.json()) as BindBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.teamId || typeof body.teamId !== "string") {
    return Response.json({ error: "Missing teamId" }, { status: 400 });
  }
  const ownsWorkspace = await fetchAuthQuery(api.integrations.ownsSlackWorkspace, {
    teamId: body.teamId,
  });
  if (!ownsWorkspace) {
    return Response.json({ error: "Slack workspace not connected to this account" }, { status: 403 });
  }

  // 3. Build the bindings array based on scope.
  let bindings: Array<{ kind: "workspace" | "channel"; id: string }>;
  if (body.scope === "workspace") {
    bindings = [{ kind: "workspace", id: body.teamId }];
  } else if (body.scope === "channels") {
    if (!Array.isArray(body.channelIds) || body.channelIds.length === 0) {
      return Response.json(
        { error: "Pick at least one channel, or choose 'Anywhere' instead." },
        { status: 400 },
      );
    }
    bindings = body.channelIds.map((channelId) => ({
      kind: "channel" as const,
      id: channelId,
    }));

    const installation = await fetchQuery(api.chatState.get, {
      key: `slack:installation:${body.teamId}`,
      secret: getSecret(),
    });
    const botToken = (installation as { botToken?: string } | null)?.botToken;
    if (!botToken) return Response.json({ error: "Slack not connected" }, { status: 404 });
    const channelResult = await listBotChannels(botToken);
    if (!channelResult.ok) {
      return Response.json({ error: "Could not validate Slack channels" }, { status: 502 });
    }
    const allowedChannelIds = new Set(channelResult.value.map((channel) => channel.id));
    if (body.channelIds.some((channelId) => !allowedChannelIds.has(channelId))) {
      return Response.json({ error: "A selected channel does not belong to this workspace" }, { status: 400 });
    }
  } else {
    return Response.json(
      { error: "scope must be 'workspace' or 'channels'" },
      { status: 400 },
    );
  }

  // 4. Call the Convex mutation. Auth check + collision prevention
  // happen inside the mutation. Errors propagate as text we can
  // surface in the UI.
  try {
    const serverProof = process.env.SLACK_BIND_INTERNAL_SECRET;
    if (!serverProof) {
      return Response.json({ error: "Slack binding is not configured" }, { status: 503 });
    }
    const result = await fetchAuthMutation(
      api.integrations.bindAgent,
      {
        agentId: id as Id<"agents">,
        platform: "slack",
        teamId: body.teamId,
        serverProof,
        bindings,
      },
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Couldn't save Slack binding";
    console.error(`[slack-bind] mutation failed for agent ${id.slice(0, 8)}:`, err);
    // 409 for collision-style errors, 500 for everything else.
    const isCollision =
      message.includes("already responding") ||
      message.includes("already bound");
    return Response.json(
      { error: message },
      { status: isCollision ? 409 : 500 },
    );
  }
}

type BindBody =
  | { scope: "workspace"; teamId: string }
  | { scope: "channels"; teamId: string; channelIds: string[] };
