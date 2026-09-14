import { getToken } from "@/lib/auth-server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";
import { listWorkspaceFiles } from "@/lib/agents/files";
import { perfTimer } from "@/lib/perf";

const AGENT_ROOT = "/home/daytona/agent";

/**
 * GET /api/agents/[id]/files?path=...
 *
 * Returns `{ files, cached, lastSyncedAt }`.
 *
 * When the sandbox is running, we serve a live listing and upsert it
 * into the Convex mirror (`agentWorkspaceFiles`) so future stopped-state
 * reads are warm.
 *
 * When the sandbox is stopped, we serve the cached listing from Convex
 * without waking the sandbox. The UI shows a "cached view" banner and
 * a Wake button so the user explicitly opts into the cold start.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id: agentId }, token] = await Promise.all([
    params,
    getToken(),
  ]);
  const timer = perfTimer("files.list.route", { agentId: agentId.slice(0, 8) });

  if (!token) {
    timer.end({ status: "unauthorized" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
    { token },
  );
  if (!agent) {
    timer.end({ status: "not-found" });
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!agent.sandboxId) {
    timer.end({ status: "not-provisioned" });
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  const url = new URL(request.url);
  const parentPath = url.searchParams.get("path") || AGENT_ROOT;

  const running = await isSandboxRunning(agent.sandboxId);

  if (!running) {
    // Stopped — serve Convex mirror without waking the sandbox.
    const cached = await fetchQuery(
      api.agentWorkspaceFiles.listByAgentAndParent,
      { agentId: agentId as Id<"agents">, parentPath },
      { token },
    );
    timer.end({ status: "ok", source: "convex", count: cached.files.length });
    return Response.json({
      files: cached.files,
      cached: true,
      lastSyncedAt: cached.lastSyncedAt,
    });
  }

  // Running — live list + opportunistic upsert to the mirror.
  try {
    const listTimer = perfTimer("files.list.daytona");
    const files = await listWorkspaceFiles(agent.sandboxId, parentPath);
    listTimer.end({ count: files.length });

    // Best-effort cache refresh. Any failure here shouldn't break the read.
    try {
      await fetchMutation(
        api.agentWorkspaceFiles.upsertListing,
        { agentId: agentId as Id<"agents">, parentPath, files },
        { token },
      );
    } catch {
      // swallow — stale cache is fine for a single failed write
    }

    timer.end({ status: "ok", source: "sandbox", count: files.length });
    return Response.json({ files, cached: false, lastSyncedAt: Date.now() });
  } catch (error) {
    timer.end({ status: "error" });
    return Response.json(
      { error: `Failed to list files: ${error}` },
      { status: 503 },
    );
  }
}

/**
 * Read the Daytona sandbox state without waking it. Mirrors the helper
 * in the memory route — small enough to keep inline rather than share.
 */
async function isSandboxRunning(sandboxId: string): Promise<boolean> {
  try {
    const daytona = getDaytona();
    const sandbox = await daytona.get(sandboxId);
    const state = (sandbox as unknown as { state?: string }).state ?? "unknown";
    return state === "started" || state === "running";
  } catch {
    return false;
  }
}
