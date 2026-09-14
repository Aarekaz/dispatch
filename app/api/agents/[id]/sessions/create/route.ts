import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import { createRuntimeAdapter } from "@/lib/runtime/factory";
import { perfTimer } from "@/lib/perf";

/**
 * POST /api/agents/[id]/sessions/create
 * Creates a new OpenCode session and returns its ID.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;
  const timer = perfTimer("session.create.route", { agentId: agentId.slice(0, 8) });

  const token = await getToken();
  if (!token) {
    timer.end({ status: "unauthorized" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agentTimer = perfTimer("session.create.convex");
  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  agentTimer.end();
  if (!agent?.sandboxId || !agent.serverPassword) {
    timer.end({ status: "not-provisioned" });
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  try {
    const { previewUrl } = await ensureAgentRunning(
      agent.sandboxId,
      agentContextFromRow(agent, agentId),
    );
    const runtime = createRuntimeAdapter(previewUrl, agent.serverPassword);
    const createTimer = perfTimer("session.create.opencode");
    const session = await runtime.createSession(
      agentId,
      `${agent.name ?? "Agent"} session`,
    );
    createTimer.end();
    timer.end({ status: "ok" });
    return Response.json({ sessionId: session.sessionExternalId });
  } catch (error) {
    timer.end({ status: "error" });
    return Response.json({ error: `Failed to create session: ${error}` }, { status: 503 });
  }
}
