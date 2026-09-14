import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import { createRuntimeAdapter } from "@/lib/runtime/factory";

/**
 * POST /api/agents/[id]/chat/cancel
 * Cancel the current run for a session.
 */
export async function POST(
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
  if (!agent?.sandboxId || !agent?.serverPassword) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const { previewUrl } = await ensureAgentRunning(
    agent.sandboxId,
    agentContextFromRow(agent, agentId),
  );
  const runtime = createRuntimeAdapter(previewUrl, agent.serverPassword);
  await runtime.cancelRun({ agentId, sessionExternalId: sessionId });

  return Response.json({ ok: true });
}
