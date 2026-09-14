import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";

/**
 * GET /api/agents/[id]/sandbox
 *
 * Returns the live state of the agent's Daytona sandbox plus the OpenCode
 * preview URL. Powers the System section on the agent management page —
 * client polls this every few seconds to show real running/stopped state
 * and the actionable preview link.
 *
 * Response shape:
 *   { state: string, previewUrl: string | null }
 *
 * `state` mirrors Daytona's sandbox state. Common values seen:
 *   - "started"   sandbox is running
 *   - "stopped"   sandbox is stopped
 *   - "starting"  transitioning to running
 *   - "stopping"  transitioning to stopped
 * The UI is defensive about other values so we don't break on new states.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id: agentId }, authed] = await Promise.all([
    params,
    isAuthenticated(),
  ]);
  if (!authed) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Non-agent ids aren't Convex ids, so skip the lookup before Convex throws
  // ArgumentValidationError on the wire.
  if (!/^[a-z0-9]{32}$/.test(agentId)) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent?.sandboxId) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  try {
    const daytona = getDaytona();
    const sandbox = await daytona.get(agent.sandboxId);
    const state = String((sandbox as { state?: string }).state ?? "unknown");

    // Preview URL is only meaningful when running. Don't waste a round trip
    // to Daytona for a stopped sandbox.
    let previewUrl: string | null = null;
    if (state === "started") {
      try {
        const preview = await sandbox.getPreviewLink(4096);
        previewUrl =
          typeof preview === "string"
            ? preview
            : preview.url.replace(/\/$/, "");
      } catch {
        // If the preview link can't be fetched, fall through with null —
        // the UI handles missing preview gracefully.
      }
    }

    // Surface all useful machine details from Daytona.
    const s = sandbox as unknown as Record<string, unknown>;
    return Response.json({
      state,
      previewUrl,
      cpu: s.cpu ?? null,
      gpu: s.gpu ?? null,
      memory: s.memory ?? null,
      disk: s.disk ?? null,
      target: s.target ?? null,
      createdAt: s.createdAt ?? null,
      updatedAt: s.updatedAt ?? null,
      autoStopInterval: s.autoStopInterval ?? null,
      errorReason: s.errorReason ?? null,
    });
  } catch (error) {
    return Response.json(
      { error: `Failed to read sandbox state: ${error}` },
      { status: 503 },
    );
  }
}
