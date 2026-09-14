/**
 * PATCH /api/users — update user profile and personalization.
 *
 * If context fields change (customInstructions, background, company,
 * industry), re-renders AGENTS.md for ALL the user's agents so they
 * inherit the updated company context.
 */
import { fetchAuthQuery, fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    nickname, company, industry, background, customInstructions, timezone,
  } = body as Record<string, string | undefined>;
  const soundEnabled =
    typeof body.soundEnabled === "boolean" ? body.soundEnabled : undefined;

  // 1. Persist to Convex
  // NOTE: `name` is managed by Better Auth (not stored in userProfiles)
  // so it's not part of api.users.update args anymore. The popover only
  // sends the editable profile fields here.
  await fetchAuthMutation(api.users.update, {
    nickname, company, industry, background, customInstructions, timezone,
    soundEnabled,
  });

  // 2. If context fields changed, re-render AGENTS.md for all agents
  const contextChanged =
    background !== undefined ||
    customInstructions !== undefined ||
    company !== undefined ||
    industry !== undefined;

  if (contextChanged) {
    try {
      const [agents, user] = await Promise.all([
        fetchAuthQuery(api.agents.list, {}),
        fetchAuthQuery(api.users.me, {}),
      ]);

      if (!user || agents.length === 0) {
        return Response.json({ ok: true });
      }

      const userContext = {
        company: user.company || undefined,
        industry: user.industry || undefined,
        background: user.background || undefined,
        customInstructions: user.customInstructions || undefined,
      };

      const results = await Promise.allSettled(
        agents.map(async (a) => {
          const full = await fetchAuthQuery(
            api.agents.get,
            { id: a.id as Id<"agents"> },
          );
          if (!full?.sandboxId) return;

          const { getDaytona } = await import("@/lib/daytona");
          const { renderAgentsMd } = await import("@/lib/agents/render-agents-md");
          const daytona = getDaytona();
          const sandbox = await daytona.get(full.sandboxId);

          const agentsMd = renderAgentsMd({
            name: full.name,
            model: full.model,
            vertical: full.vertical || "general",
            persona: full.persona ?? undefined,
            toolPermissions: full.toolPermissions ?? undefined,
            composioToolkits: full.composioToolkits ?? undefined,
            channels: full.channels ?? undefined,
            userContext,
          });

          await sandbox.fs.uploadFiles([{
            source: Buffer.from(agentsMd),
            destination: "/home/daytona/agent/AGENTS.md",
          }]);
        }),
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(
          `[users PATCH] ${failures.length}/${agents.length} AGENTS.md re-renders failed`,
        );
      }
    } catch (err) {
      // User data was saved — AGENTS.md propagation is best-effort
      console.error("[users PATCH] Failed to propagate to agents:", err);
    }
  }

  return Response.json({ ok: true });
}
