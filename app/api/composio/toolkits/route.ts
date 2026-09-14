/**
 * GET /api/composio/toolkits
 *
 * Two modes, selected by query params:
 *
 *   1. **Catalog mode** (no query params) — returns the full Composio
 *      toolkit catalog `{ slug, name, logo?, description?, category? }[]`.
 *      Aggressively cached server-side, cheap to call.
 *
 *   2. **Status mode** (`?status=1&agentId=<id>`) — returns per-toolkit
 *      connection status for the specified agent, scoped to the
 *      per-agent Composio identity `${userId}:${agentId}`. The UI
 *      uses this to render the ✅ Connected / ⚠ Needs auth pills
 *      with account labels (`sales@acme.com`, etc.).
 *
 * Auth: Convex session required. In status mode we additionally
 * verify the caller owns the target agent before calling Composio.
 *
 * The `userId` that scopes Composio lookups comes from the agent row
 * (`agent.userId`) — never from the client. That's the same rule the
 * runtime enforces for the web chat route, kept consistent here so
 * the UI can't query another user's agent.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  getConnectionStatus,
  listAvailableToolkits,
} from "@/lib/composio/toolkits";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusMode = url.searchParams.get("status") === "1";

  if (!statusMode) {
    const toolkits = await listAvailableToolkits();
    return Response.json({ toolkits });
  }

  // Status mode — must specify the agent whose connections to check.
  const agentId = url.searchParams.get("agentId");
  if (!agentId) {
    return Response.json(
      { error: "agentId is required in status mode" },
      { status: 400 },
    );
  }

  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent) {
    // `api.agents.get` enforces ownership — null means either missing
    // or not owned. Treat both the same way for the caller.
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const statuses = await getConnectionStatus({
    userId: agent.userId as unknown as string,
    agentId: agent.id as unknown as string,
    toolkits: agent.composioToolkits ?? [],
  });

  return Response.json({ statuses });
}
