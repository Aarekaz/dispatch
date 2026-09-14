/**
 * POST /api/composio/disconnect
 *
 * Disconnects a Composio account for a specific (agent, toolkit)
 * pair. Deletes the OAuth credential from Composio's vault; the
 * toolkit itself remains enabled for the agent (it's still in
 * `composioToolkits`). Next time the agent tries to use a tool
 * from that toolkit, the in-chat `COMPOSIO_MANAGE_CONNECTIONS`
 * flow will prompt for re-auth.
 *
 * ## Security
 *
 * Takes `(agentId, toolkit)` rather than a raw connection ID.
 * We verify agent ownership via `api.agents.get` (which enforces
 * `userId === caller`), then look up the ACTIVE connection for
 * that agent's composite identity, then delete it. This means a
 * caller can only delete connections for agents they own —
 * there's no path to delete a random connection ID belonging to
 * another user.
 *
 * Method is POST (not DELETE) because some proxies / frameworks
 * strip DELETE request bodies, and we need the body for
 * `agentId` + `toolkit`. POST is the safer choice for body-
 * carrying state-changing requests.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { disconnectToolkit } from "@/lib/composio/disconnect";

const SLUG = /^[a-z0-9_-]+$/;

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentId, toolkit } = (body ?? {}) as {
    agentId?: string;
    toolkit?: string;
  };

  if (!agentId || typeof agentId !== "string") {
    return Response.json({ error: "agentId is required" }, { status: 400 });
  }
  if (!toolkit || typeof toolkit !== "string" || !SLUG.test(toolkit)) {
    return Response.json(
      { error: "toolkit must be a lowercase slug" },
      { status: 400 },
    );
  }

  // Verify agent ownership via the standard projection, which
  // enforces `agent.userId === caller` server-side in Convex.
  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const result = await disconnectToolkit({
    userId: agent.userId as unknown as string,
    agentId,
    toolkit,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json({
    ok: true,
    deletedConnectionId: result.deletedConnectionId,
  });
}
