import { fetchQuery } from "convex/nextjs";
import type { Message, Thread } from "chat";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getBindingKeys } from "@/lib/chat/routing/binding-key";
import { getSecret } from "@/lib/chat/secrets";

/**
 * Routing layer: given an inbound webhook from a Chat SDK platform,
 * find the Dispatch agent that should handle it — using scope
 * precedence (channel-specific overrides workspace-wide).
 *
 * The lookup walks `getBindingKeys()` in order, returning the first
 * agent that matches. For Slack: tries `chan:<channelId>` first,
 * then falls back to `team:<teamId>`. So a workspace-wide
 * "executive assistant" coexists with channel-scoped "support agent"
 * in the same Slack workspace, and the support agent wins inside
 * its bound channels.
 *
 * Returns `null` if no binding matches OR if the matched agent has
 * no provisioned Daytona sandbox yet. Callers (the Chat SDK handlers
 * in `lib/chat/handlers/*`) must surface a visible error message
 * back to the customer — never a silent timeout.
 */
export type ResolvedAgent = {
  agentId: Id<"agents">;
  agentName: string;
  /**
   * Convex user id of the agent *owner* — NOT whoever is chatting.
   * This is half of the Composio identity `${userId}:${agentId}` that
   * scopes the agent's external tool connections. The Slack/Telegram
   * chatter is irrelevant to Composio; connections belong to the
   * Dispatch user who created the agent.
   */
  userId: string; // Better Auth user id
  sandboxId: string;
  serverPassword: string;
  toolPermissions: string | null;
  /**
   * Composio toolkit slugs the agent has access to. Always present
   * (defaults to `[]` for agents that predate the field).
   */
  composioToolkits: string[];
  /**
   * Per-installation encrypted config — empty for Phase 1b.
   * Reserved for Phase 2 if we move per-workspace tokens out of
   * Chat SDK's state-adapter storage and into agentIntegrations.
   */
  encryptedConfig: string;
};

/**
 * Resolve the agent that should handle a Chat SDK message,
 * walking scope precedence per platform.
 */
export async function resolveAgentForThread(
  thread: Thread,
  message: Message,
): Promise<ResolvedAgent | null> {
  const platform = thread.adapter.name;
  const candidates = getBindingKeys(thread, message);

  for (const channelBinding of candidates) {
    const result = await fetchQuery(api.integrations.findByBinding, {
      platform,
      channelBinding,
      secret: getSecret(),
    });

    if (!result) continue;
    if (!result.sandboxId || !result.serverPassword) {
      // Bound but not provisioned. Skip — try the next scope.
      // This can happen if a newer (more specific) binding points
      // at an unprovisioned agent: we'd rather fall back to the
      // workspace agent than fail silently.
      continue;
    }

    return {
      agentId: result.agentId,
      agentName: result.agentName,
      userId: result.userId,
      sandboxId: result.sandboxId,
      serverPassword: result.serverPassword,
      toolPermissions: result.toolPermissions,
      composioToolkits: result.composioToolkits,
      encryptedConfig: result.encryptedConfig,
    };
  }

  return null;
}

