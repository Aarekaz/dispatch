/**
 * POST /api/agents/:id/memory/sync
 *
 * Force-sync memory files from sandbox filesystem to Convex.
 * Called by the "Sync" button in the agent management Knowledge section.
 * Awaits completion so the UI can show results.
 */
import { getToken, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { syncAgentMemory } from "@/lib/agents/memory-sync";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const agent = await fetchAuthQuery(api.agents.get, {
    id: id as Id<"agents">,
  });
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!agent.sandboxId) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  try {
    const result = await syncAgentMemory(id, agent.sandboxId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[memory/sync] force sync failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
