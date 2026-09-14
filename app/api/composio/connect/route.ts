/**
 * POST /api/composio/connect
 *
 * Initiates a Composio connection flow for a specific (agent, toolkit)
 * pair. Returns a hosted OAuth redirect URL that the frontend opens
 * in a popup window. After the user completes auth, Composio
 * redirects the popup to our `/auth/composio/callback` page with
 * `?status=success&connectedAccountId=...` query params; the parent
 * window polls the popup URL, detects those params, and closes the
 * popup.
 *
 * The pattern here follows the Composio docs:
 *   - Manual authorization via `session.authorize()` (tr-auth-manual.md)
 *   - Popup-based completion UI (app-auth-popup-ui.md)
 *   - Dedicated callback page at /auth/composio/callback
 *
 * ## Auth and scoping
 *
 * The agent's owner userId is the source of truth for who can
 * initiate connections — NOT the authenticated request caller.
 * They're usually the same (owners managing their own agents) but
 * we always route through `api.agents.get` which enforces
 * ownership server-side, so a non-owner with a stolen token can't
 * initiate a connection on someone else's agent.
 *
 * We also validate that the toolkit is in the agent's enabled list
 * (`agent.composioToolkits`). Users shouldn't be able to connect
 * a toolkit they haven't first enabled + saved in the settings UI —
 * that keeps the settings UI the single source of truth for which
 * toolkits an agent has access to.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initiateConnection } from "@/lib/composio/connect";

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

  const agent = await fetchAuthQuery(
    api.agents.get,
    { id: agentId as Id<"agents"> },
  );
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  // Only allow connecting toolkits the agent has actually enabled.
  // Keeps the settings UI the single source of truth.
  const enabled = agent.composioToolkits ?? [];
  if (!enabled.includes(toolkit)) {
    return Response.json(
      {
        error: `Toolkit "${toolkit}" is not enabled for this agent. Enable it in settings first.`,
      },
      { status: 400 },
    );
  }

  // Build the callback URL from the request origin so it works across
  // localhost (dev) and the deployed URL (prod) without per-env config.
  // Composio requires an absolute URL here.
  const origin = new URL(request.url).origin;
  const callbackUrl = `${origin}/auth/composio/callback`;

  const result = await initiateConnection({
    userId: agent.userId as unknown as string,
    agentId,
    toolkit,
    callbackUrl,
  });

  if (!result) {
    return Response.json(
      {
        error:
          "Failed to initiate connection. Check server logs for details.",
      },
      { status: 502 },
    );
  }

  return Response.json(result);
}
