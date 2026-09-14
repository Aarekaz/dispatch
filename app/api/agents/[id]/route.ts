import { getToken } from "@/lib/auth-server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * GET /api/agents/[id] — Get a single agent
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, token] = await Promise.all([params, getToken()]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(api.agents.get, { id: id as Id<"agents"> }, { token });
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  return Response.json(agent);
}

/**
 * PATCH /api/agents/[id] — Update agent settings
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, token, body] = await Promise.all([
    params,
    getToken(),
    request.json(),
  ]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const {
    name,
    model,
    vertical,
    emoji,
    email,
    endpoint,
    persona,
    toolPermissions,
    composioToolkits,
    toolkitAdd,
    toolkitRemove,
  } = body as {
    name?: string;
    model?: string;
    vertical?: string;
    emoji?: string;
    email?: string;
    endpoint?: string;
    persona?: string;
    toolPermissions?: "conservative" | "balanced" | "permissive";
    composioToolkits?: string[];
    // Incremental toolkit ops — mutually exclusive with composioToolkits
    // and with each other. Used by the Connect page to avoid the race
    // where two rapid-fire Connect clicks on different toolkits each
    // PATCH a full list built from the same stale client snapshot,
    // silently dropping whichever commits first.
    toolkitAdd?: string;
    toolkitRemove?: string;
  };

  // Validate composioToolkits shape if provided. Toolkit slugs are
  // lowercase alphanumeric with underscores/hyphens, and we cap the
  // list at 50 to bound both the Convex write size and the Composio
  // session creation payload.
  const SLUG = /^[a-z0-9_-]+$/;
  if (composioToolkits !== undefined) {
    if (!Array.isArray(composioToolkits) || composioToolkits.length > 50) {
      return Response.json(
        { error: "composioToolkits must be an array of ≤50 slug strings" },
        { status: 400 },
      );
    }
    for (const slug of composioToolkits) {
      if (typeof slug !== "string" || !SLUG.test(slug)) {
        return Response.json(
          { error: `Invalid toolkit slug: ${String(slug)}` },
          { status: 400 },
        );
      }
    }
  }
  for (const op of [toolkitAdd, toolkitRemove]) {
    if (op !== undefined && (typeof op !== "string" || !SLUG.test(op))) {
      return Response.json(
        { error: `Invalid toolkit slug: ${String(op)}` },
        { status: 400 },
      );
    }
  }
  if (
    [composioToolkits, toolkitAdd, toolkitRemove].filter(
      (v) => v !== undefined,
    ).length > 1
  ) {
    return Response.json(
      {
        error:
          "composioToolkits, toolkitAdd, and toolkitRemove are mutually exclusive",
      },
      { status: 400 },
    );
  }

  if (toolkitAdd !== undefined) {
    await fetchMutation(
      api.agents.addToolkit,
      { id: id as Id<"agents">, toolkit: toolkitAdd },
      { token },
    );
  } else if (toolkitRemove !== undefined) {
    await fetchMutation(
      api.agents.removeToolkit,
      { id: id as Id<"agents">, toolkit: toolkitRemove },
      { token },
    );
  }

  await fetchMutation(
    api.agents.update,
    {
      id: id as Id<"agents">,
      name,
      model,
      vertical,
      emoji,
      email,
      endpoint,
      persona,
      toolPermissions,
      composioToolkits,
    },
    { token },
  );

  // All three sandbox-sync paths below share the same precondition:
  // the sandbox has to be running, or the work fails (AGENTS.md
  // upload dies with "no IP address found", rebuildAgentOpenCode
  // wakes the sandbox unnecessarily, model hot-swap via config.update
  // needs a live OpenCode server). We do ONE fetch + ONE state probe
  // upfront and fan out from there.
  //
  // When the sandbox is stopped, we skip every branch silently. The
  // agent's Convex row is already authoritative — on the NEXT cold
  // boot, ensureAgentRunning reads fresh data, `buildOpenCodeConfig`
  // constructs a fresh OpenCode config with the new model, and
  // `renderAgentsMd` would be regenerated then too. No work is lost,
  // and the user gets an instant save response instead of eating a
  // 5-second sandbox-wake on every settings edit.
  // The incremental toolkit ops change composioToolkits too — downstream
  // sync logic treats "toolkit field changed" as a single concept, so
  // we fold them together here.
  const toolkitsChanged =
    composioToolkits !== undefined ||
    toolkitAdd !== undefined ||
    toolkitRemove !== undefined;
  const needsSandboxSync =
    persona !== undefined ||
    model !== undefined ||
    toolkitsChanged ||
    toolPermissions !== undefined;

  if (needsSandboxSync) {
    try {
      const agent = await fetchQuery(
        api.agents.get,
        { id: id as Id<"agents"> },
        { token },
      );
      if (agent?.sandboxId) {
        const { getDaytona } = await import("@/lib/daytona");
        const daytona = getDaytona();
        const sandbox = await daytona.get(agent.sandboxId);
        const state = (sandbox as unknown as { state?: string }).state;
        const isRunning = state === "started" || state === "running";

        if (!isRunning) {
          // Sandbox is stopped — defer all sync to next cold boot.
          // See block comment above for why this is safe.
          console.log(
            `[agent PATCH] Sandbox ${agent.sandboxId.slice(0, 8)} stopped — sync deferred to next wake`,
          );
        } else {
          // ── Warm path: sandbox is running ──

          // 1. Regenerate AGENTS.md so the agent's on-disk self-
          //    reference reflects the DB state.
          try {
            const { renderAgentsMd } = await import(
              "@/lib/agents/render-agents-md"
            );
            const user = await fetchQuery(api.users.me, {}, { token });
            const userContext = user
              ? {
                  company: user.company || undefined,
                  industry: user.industry || undefined,
                  background: user.background || undefined,
                  customInstructions: user.customInstructions || undefined,
                }
              : undefined;

            const agentsMd = renderAgentsMd({
              name: agent.name,
              model: agent.model,
              vertical: "general",
              persona: agent.persona ?? undefined,
              toolPermissions: agent.toolPermissions ?? undefined,
              composioToolkits: agent.composioToolkits ?? undefined,
              channels: agent.channels ?? undefined,
              userContext,
            });

            await sandbox.fs.uploadFiles([
              {
                source: Buffer.from(agentsMd),
                destination: "/home/daytona/agent/AGENTS.md",
              },
            ]);
          } catch (err) {
            console.error(
              "[agent PATCH] Failed to regenerate AGENTS.md:",
              err,
            );
          }

          // 2. If toolkit fields changed, rebuild OpenCode with the
          //    new Composio MCP config. The rebuild is 3-5s but
          //    required — without it, the running OpenCode server
          //    keeps the old toolkit set until its own restart.
          if (toolkitsChanged) {
            try {
              const { rebuildAgentOpenCode } = await import(
                "@/lib/agents/ensure-running"
              );
              await rebuildAgentOpenCode(agent.sandboxId, {
                name: agent.name,
                model: agent.model,
                persona: agent.persona,
                toolPermissions: agent.toolPermissions,
                userId: agent.userId as unknown as string,
                agentId: id,
                composioToolkits: agent.composioToolkits,
                serverPassword: agent.serverPassword,
              });
            } catch (err) {
              console.error(
                "[agent PATCH] Failed to rebuild OpenCode:",
                err,
              );
            }
          }

          // 3. If model changed, hot-swap it via OpenCode's config
          //    update API. Cheaper than a full rebuild — no server
          //    restart, just a config patch on the running instance.
          if (model) {
            try {
              const { getOpenCodeModelRef } = await import("@/lib/models");
              const { createOpencodeClient } = await import(
                "@opencode-ai/sdk/client"
              );
              const { ensureAgentRunning, agentContextFromRow } =
                await import("@/lib/agents/ensure-running");
              const { basicAuthorization } = await import("@/lib/security/runtime-auth");
              // ensureAgentRunning returns the preview URL. On the
              // warm path it hits the cache and returns in ~0ms.
              const { previewUrl } = await ensureAgentRunning(
                agent.sandboxId,
                agentContextFromRow(agent, id),
              );
              if (!agent.serverPassword) throw new Error("Agent runtime password is missing");
              const client = createOpencodeClient({
                baseUrl: previewUrl,
                headers: { Authorization: basicAuthorization(agent.serverPassword) },
              });
              const updateBody = {
                agent: {
                  daytona: { model: getOpenCodeModelRef(model) },
                },
              };
              await client.config.update({
                body: updateBody,
              });
            } catch (err) {
              console.error("[agent PATCH] Failed to update model:", err);
            }
          }
        }
      }
    } catch (err) {
      console.error("[agent PATCH] Sandbox sync failed:", err);
    }
  }

  return Response.json({ ok: true });
}

/**
 * DELETE /api/agents/[id] — Delete an agent + cleanup
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, token] = await Promise.all([params, getToken()]);
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await fetchQuery(api.agents.get, { id: id as Id<"agents"> }, { token });
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  // TODO: Also clean up Daytona sandbox + volume when wired
  // if (agent.sandboxId) {
  //   const daytona = getDaytona();
  //   try { await daytona.delete(await daytona.get(agent.sandboxId)); } catch {}
  // }

  await fetchMutation(api.agents.remove, { id: id as Id<"agents"> }, { token });

  return Response.json({ ok: true });
}
