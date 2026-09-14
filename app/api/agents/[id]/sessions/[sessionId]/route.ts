import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import { createRuntimeAdapter } from "@/lib/runtime/factory";
import { perfTimer } from "@/lib/perf";

/**
 * GET /api/agents/[id]/sessions/[sessionId] — Get messages for a session
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id: agentId, sessionId } = await params;
  const timer = perfTimer("sessions.messages.route", { sid: sessionId.slice(-8) });

  const token = await getToken();
  if (!token) {
    timer.end({ status: "unauthorized" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  if (!agent?.sandboxId || !agent?.serverPassword) {
    timer.end({ status: "not-provisioned" });
    return Response.json([]);
  }

  try {
    const { previewUrl } = await ensureAgentRunning(
      agent.sandboxId,
      agentContextFromRow(agent, agentId),
    );
    const runtime = createRuntimeAdapter(previewUrl, agent.serverPassword);
    const msgTimer = perfTimer("sessions.messages.opencode");
    const messages = await runtime.getSessionMessages({
      agentId,
      sessionExternalId: sessionId,
    });
    msgTimer.end({ count: messages.length });
    timer.end({ status: "ok", count: messages.length });
    return Response.json(messages);
  } catch {
    timer.end({ status: "error" });
    return Response.json([]);
  }
}
