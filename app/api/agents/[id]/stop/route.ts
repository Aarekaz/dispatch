import { getToken, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";

/**
 * POST /api/agents/[id]/stop
 *
 * Stops the agent's Daytona sandbox. Mirror of /restart but without the
 * re-start step — used by the System section's Stop button.
 *
 * Stopping a sandbox is safe: the next call that needs the agent (chat,
 * cron tick, channel webhook) goes through `ensureAgentRunning()` which
 * resumes the sandbox automatically. So "Stop" is more accurately "release
 * the running container until it's needed again."
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id: agentId }, token] = await Promise.all([
    params,
    getToken(),
  ]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchAuthQuery(api.agents.get, {
    id: agentId as Id<"agents">,
  });
  if (!agent?.sandboxId) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  try {
    const daytona = getDaytona();
    const sandbox = await daytona.get(agent.sandboxId);
    await sandbox.stop();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: `Stop failed: ${error}` }, { status: 503 });
  }
}
