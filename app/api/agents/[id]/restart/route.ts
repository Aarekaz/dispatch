import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { rebuildAgentOpenCode } from "@/lib/agents/ensure-running";

/**
 * POST /api/agents/[id]/restart
 *
 * Force-restart the OpenCode server on the sandbox with a fresh
 * config — picks up any changes to the system prompt, Composio
 * MCP block, or other startup-baked fields.
 *
 * Uses `rebuildAgentOpenCode` (the same path PATCH uses when
 * `composioToolkits` changes) so the restart is consistent with
 * the save flow: we pass the full agent context, which means
 * the rebuilt config includes Composio MCP if the agent has
 * toolkits enabled.
 *
 * This is cheaper than `sandbox.stop() + sandbox.start()` —
 * we only kill the opencode process and reboot it, leaving the
 * sandbox itself running.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id: agentId }, token] = await Promise.all([
    params,
    getToken(),
  ]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  if (!agent?.sandboxId) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  try {
    const { previewUrl } = await rebuildAgentOpenCode(agent.sandboxId, {
      name: agent.name,
      model: agent.model,
      persona: agent.persona,
      toolPermissions: agent.toolPermissions,
      userId: agent.userId as unknown as string,
      agentId,
      composioToolkits: agent.composioToolkits,
    });

    return Response.json({ ok: true, previewUrl });
  } catch (error) {
    return Response.json({ error: `Restart failed: ${error}` }, { status: 503 });
  }
}
