import { fetchAuthMutation, fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * POST /api/slack/disconnect
 *
 * Disconnects a single agent from Slack by removing its `agentIntegrations`
 * row. Unlike Telegram, we do NOT revoke the underlying Slack installation
 * — the Chat SDK bot token lives at workspace scope (`chatKv`) and is
 * shared across every agent bound to the same Slack team. Revoking it
 * here would break all sibling agents using the same workspace.
 *
 * What "disconnect" means for Slack:
 *   • Remove this agent's binding (so delivery stops routing here).
 *   • Leave the Slack app installed in the workspace — the user can
 *     reconnect without a fresh OAuth flow.
 *   • If the user wants to uninstall the Slack app entirely, they do
 *     that from Slack admin.
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
    return Response.json({ error: "agentId is required" }, { status: 400 });
  }

  const integrations = await fetchAuthQuery(
    api.integrations.list,
    { agentId: agentId as Id<"agents"> },
  );

  const slackIntegration = integrations.find((i) => i.platform === "slack");

  if (!slackIntegration) {
    return Response.json(
      { error: "No Slack integration found for this agent" },
      { status: 404 },
    );
  }

  try {
    await fetchAuthMutation(
      api.integrations.remove,
      { id: slackIntegration.id },
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
    `[slack:disconnect] Disconnected agent ${agentId.slice(0, 8)}...`,
  );

  return Response.json({ ok: true });
}
