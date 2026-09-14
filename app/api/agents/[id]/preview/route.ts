import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";

/**
 * GET /api/agents/[id]/preview?port=3000
 * Returns the Daytona sandbox preview URL for a given port.
 */
export async function GET(
  request: Request,
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

  const url = new URL(request.url);
  const port = Number(url.searchParams.get("port") ?? "3000");

  try {
    await ensureAgentRunning(agent.sandboxId, agentContextFromRow(agent, agentId));
    const daytona = getDaytona();
    const sandbox = await daytona.get(agent.sandboxId);
    const preview = await sandbox.getPreviewLink(port);
    const previewUrl = typeof preview === "string" ? preview : preview.url;
    return Response.json({ url: previewUrl, port });
  } catch (error) {
    return Response.json({ error: `Failed to get preview: ${error}` }, { status: 503 });
  }
}
