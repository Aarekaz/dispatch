/**
 * GET /api/slack/channels?teamId=T123&agentId=abc123
 *
 * Returns the list of Slack channels the bot is a member of.
 * Used by the delivery channel picker in automation settings.
 *
 * Auth-gated via Convex token. The agentId param is required so we
 * can verify the authenticated user owns the agent and the agent
 * actually has a Slack binding for the requested teamId.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { listBotChannels } from "@/lib/automations/triggers/slack-api";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let teamId = searchParams.get("teamId");
  const agentId = searchParams.get("agentId");
  if (!agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }

  // Verify the user owns this agent (agents.get is auth-gated)
  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 403 });
  }
  const user = await fetchAuthQuery(api.users.me, {});
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Verify the agent has a Slack integration
  const integrations = await fetchAuthQuery(
    api.integrations.list,
    { agentId: agentId as Id<"agents"> },
  );
  const slackIntegration = integrations.find((i) => i.platform === "slack");
  if (!slackIntegration) {
    return Response.json(
      { error: "Agent does not have a Slack integration" },
      { status: 403 },
    );
  }

  // If no teamId provided, try to derive from the agent's channel binding
  if (!teamId && slackIntegration.channelBinding?.startsWith("team:")) {
    teamId = slackIntegration.channelBinding.replace("team:", "");
  }
  if (!teamId) {
    return Response.json(
      { error: "Cannot determine Slack workspace. Make sure Slack is connected on the agent." },
      { status: 400 },
    );
  }

  // Look up bot token from Convex chatState
  const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET ?? "";
  const ownership = await fetchQuery(api.chatState.get, {
    key: `slack:owner:${teamId}:${user.id}`,
    secret: chatSecret,
  });
  if (ownership !== true) {
    return Response.json({ error: "Slack workspace not connected to this account" }, { status: 403 });
  }
  const installation = await fetchQuery(api.chatState.get, {
    key: `slack:installation:${teamId}`,
    secret: chatSecret,
  });

  if (!installation) {
    return Response.json({ error: "Slack not connected" }, { status: 404 });
  }

  const botToken = (installation as { botToken?: string }).botToken;
  if (!botToken) {
    return Response.json({ error: "No bot token" }, { status: 404 });
  }

  const result = await listBotChannels(botToken);
  if (!result.ok) {
    return Response.json(
      { error: `Slack API error: ${result.error.kind}` },
      { status: 502 },
    );
  }

  return Response.json({
    channels: result.value.map((c) => ({
      id: c.id,
      name: c.name,
    })),
  });
}
