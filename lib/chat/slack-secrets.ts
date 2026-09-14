import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Server-side helper: return the Chat SDK Slack bot token for an
 * agent, if the agent has a workspace-level Slack binding AND an
 * active installation in `chatKv`.
 *
 * Uses `api.integrations.getSlackBotTokenForAgent` which does the
 * `agentIntegrations` → `chatKv` join in a single Convex query.
 *
 * Returns `null` for ANY of:
 *   - Agent has no Slack integration
 *   - Integration is channel-bound (`chan:C…`) rather than workspace
 *   - Workspace has no installation row (revoked / not yet installed)
 *   - Convex is unreachable
 *
 * Callers use this to decide whether to inject `SLACK_BOT_TOKEN`
 * into the sandbox environment so the agent can search Slack
 * history via the `bash` tool.
 */
export async function getSlackBotTokenForAgent(
  agentId: string,
): Promise<string | null> {
  const secret = process.env.CHAT_STATE_INTERNAL_SECRET;
  if (!secret) return null;

  try {
    return await fetchQuery(api.integrations.getSlackBotTokenForAgent, {
      agentId: agentId as Id<"agents">,
      secret,
    });
  } catch (err) {
    console.warn(
      "[slack-secrets] Failed to fetch Slack bot token for agent:",
      err,
    );
    return null;
  }
}
