import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import { createRuntimeAdapter } from "@/lib/runtime/factory";
import { perfTimer } from "@/lib/perf";

/**
 * Short TTL cache for the sessions list.
 * The OpenCode session.list API has no pagination and takes ~2-3s for
 * users with 100+ sessions. Page loads fire this endpoint 3-5 times,
 * so caching cuts those redundant calls to ~0ms.
 */
const SESSIONS_CACHE_TTL_MS = 10_000;
const sessionsCache = new Map<string, { data: unknown; expiresAt: number }>();

/**
 * GET /api/agents/[id]/sessions — List sessions from OpenCode
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;
  const timer = perfTimer("sessions.list.route", { agentId: agentId.slice(0, 8) });

  const token = await getToken();
  if (!token) {
    timer.end({ status: "unauthorized" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check cache first — cheap and bypasses everything below
  const cached = sessionsCache.get(agentId);
  if (cached && Date.now() < cached.expiresAt) {
    timer.end({ status: "cache-hit" });
    return Response.json(cached.data);
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
    const listTimer = perfTimer("sessions.list.opencode");
    const sessions = await runtime.listSessions(agentId);
    listTimer.end({ count: sessions.length });

    sessionsCache.set(agentId, {
      data: sessions,
      expiresAt: Date.now() + SESSIONS_CACHE_TTL_MS,
    });

    timer.end({ status: "ok", count: sessions.length });
    return Response.json(sessions);
  } catch {
    timer.end({ status: "error" });
    return Response.json([]);
  }
}
