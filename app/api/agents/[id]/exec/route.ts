import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";

/**
 * POST /api/agents/[id]/exec
 * Execute a command in the Daytona sandbox. Returns stdout/stderr.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id: agentId }, token] = await Promise.all([
    params,
    getToken(),
  ]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  if (!agent?.sandboxId) {
    return Response.json({ error: "Agent not provisioned" }, { status: 400 });
  }

  const body = await request.json();
  const { command, cwd } = body as { command: string; cwd?: string };
  if (!command) {
    return Response.json({ error: "command is required" }, { status: 400 });
  }

  try {
    await ensureAgentRunning(agent.sandboxId, agentContextFromRow(agent, agentId));
    const daytona = getDaytona();
    const sandbox = await daytona.get(agent.sandboxId);
    const result = await sandbox.process.executeCommand(command, cwd);

    return Response.json({
      exitCode: result.exitCode,
      output: result.result ?? "",
    });
  } catch (error) {
    return Response.json({ error: `Exec failed: ${error}` }, { status: 503 });
  }
}
