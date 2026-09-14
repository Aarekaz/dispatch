import { getToken } from "@/lib/auth-server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { provisionAgent } from "@/lib/agents/create";

/**
 * GET /api/agents — List agents for current user
 */
export async function GET() {
  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agents = await fetchQuery(api.agents.list, {}, { token });
  return Response.json(agents);
}

/**
 * POST /api/agents — Create a new agent with Daytona sandbox
 */
export async function POST(request: Request) {
  const [token, body] = await Promise.all([
    getToken(),
    request.json(),
  ]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name, slug, vertical, model, emoji, persona } = body;

  if (!name || !slug || !vertical || !model) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Create the Convex record first (draft status)
  const agentId = await fetchMutation(
    api.agents.create,
    { name, slug, vertical, model, emoji, persona },
    { token },
  );

  // 2. Provision Daytona sandbox + volume
  try {
    const user = await fetchQuery(api.users.me, {}, { token });
    const { sandboxId, volumeId, serverPassword } = await provisionAgent({
      userId: user?.id ?? "unknown",
      slug,
      name,
      model,
      vertical,
      persona,
    });

    // 3. Update Convex with sandbox info + set status to active
    await fetchMutation(
      api.agents.updateSandboxInfo,
      { id: agentId, sandboxId, volumeId, serverPassword },
      { token },
    );
    await fetchMutation(
      api.agents.update,
      { id: agentId, status: "active" },
      { token },
    );

    return Response.json({ id: agentId, sandboxId, volumeId }, { status: 201 });
  } catch (error) {
    // Provisioning failed — delete the draft agent, return error
    console.error("Agent provisioning failed:", error);
    try {
      await fetchMutation(api.agents.remove, { id: agentId }, { token });
    } catch {
      // Best effort cleanup
    }
    return Response.json(
      { error: `Provisioning failed: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 503 },
    );
  }
}
