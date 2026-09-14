import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";

/**
 * Shared secret check for webhook-callable internal queries.
 * Uses the same env var as `convex/chatState.ts` — both represent
 * the "Vercel-runtime → Convex-internal" trust boundary.
 */
function requireWebhookSecret(secret: string): void {
  if (!secret || secret !== process.env.CHAT_STATE_INTERNAL_SECRET) {
    throw new Error("Forbidden — invalid webhook secret");
  }
}

/**
 * List integrations for an agent (strips encrypted config).
 */
export const list = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) return [];

    const integrations = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .take(20);

    return integrations.map((i) => ({
      id: i._id,
      platform: i.platform,
      channelBinding: i.channelBinding,
    }));
  },
});

export const upsert = mutation({
  args: {
    agentId: v.id("agents"),
    platform: v.union(v.literal("slack"), v.literal("telegram"), v.literal("whatsapp"), v.literal("discord"), v.literal("email")),
    encryptedConfig: v.string(),
    channelBinding: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .take(20);

    const match = existing.find((i) => i.platform === args.platform);
    if (match) {
      await ctx.db.patch(match._id, {
        encryptedConfig: args.encryptedConfig,
        channelBinding: args.channelBinding,
      });
      return match._id;
    }

    return await ctx.db.insert("agentIntegrations", {
      agentId: args.agentId,
      platform: args.platform,
      encryptedConfig: args.encryptedConfig,
      channelBinding: args.channelBinding,
    });
  },
});

/**
 * Aggregated integration summary across ALL of the current user's agents.
 *
 * Powers the Integrations section on the settings page. For each platform
 * connected on at least one agent, returns the platform key + a count of
 * how many agents it's connected on. Used as a high-level overview only —
 * actual per-agent connection management lives on /[agentId]/connect.
 */
export const summaryForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    if (agents.length === 0) return [];

    const allIntegrations = await Promise.all(
      agents.map((agent) =>
        ctx.db
          .query("agentIntegrations")
          .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
          .take(20),
      ),
    );

    // Group by platform → count of distinct agents.
    const counts = new Map<string, number>();
    for (const integrations of allIntegrations) {
      // De-dupe within an agent (in case the same platform appears twice
      // for some reason — shouldn't happen but defensive).
      const platforms = new Set(integrations.map((i) => i.platform));
      for (const platform of platforms) {
        counts.set(platform, (counts.get(platform) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([platform, agentCount]) => ({ platform, agentCount }))
      .sort((a, b) => b.agentCount - a.agentCount);
  },
});

export const ownsSlackWorkspace = query({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    const userId = await requireUserId(ctx);
    const ownership = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) =>
        q.eq("key", `slack:owner:${teamId}:${userId}`),
      )
      .first();
    return Boolean(ownership);
  },
});

/**
 * Bind an agent to a Slack channel or workspace from a UI flow
 * (the slack-pick page). Authenticated via Convex Auth — the user
 * must own the target agent.
 *
 * Enforces two collision rules at write time:
 *
 *   1. **At most one workspace-wide agent per (platform, workspace).**
 *      If the customer tries to bind Bob workspace-wide when Sara is
 *      already workspace-wide in the same Slack, the mutation throws
 *      a clear error. The customer must remove Sara's binding first.
 *
 *   2. **At most one agent per (platform, channel).**
 *      If Marcus is already bound to #support and the customer tries
 *      to bind Ada to #support, the mutation throws. The customer
 *      must pick a different channel or remove Marcus first.
 *
 * Idempotent for the *same* agent: re-running the bind for an agent
 * that already has the same binding is a no-op (returns the existing
 * row). This means re-running OAuth → picker → submit doesn't error.
 *
 * The `bindings` argument is an array because workspace-wide binding
 * is one entry, while "specific channels" binding is one entry per
 * picked channel — both flow through the same mutation in one
 * transaction.
 */
export const bindAgent = mutation({
  args: {
    agentId: v.id("agents"),
    platform: v.union(v.literal("slack"), v.literal("telegram"), v.literal("whatsapp"), v.literal("discord"), v.literal("email")),
    teamId: v.optional(v.string()),
    serverProof: v.string(),
    // One entry per binding to create. For "anywhere" mode, a single
    // entry with kind="workspace". For "specific channels" mode, one
    // entry per checked channel with kind="channel".
    bindings: v.array(
      v.object({
        kind: v.union(v.literal("workspace"), v.literal("channel")),
        // The Slack team_id for kind="workspace", or channel_id for
        // kind="channel". The mutation prefixes them appropriately.
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (!args.serverProof || args.serverProof !== process.env.SLACK_BIND_INTERNAL_SECRET) {
      throw new Error("Forbidden — invalid Slack bind proof");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) {
      throw new Error("Agent not found");
    }

    if (args.bindings.length === 0) {
      throw new Error("Pick at least one channel or 'anywhere'");
    }

    // Build the prefixed binding keys. Must match `lib/chat/routing/binding-key.ts`.
    const bindingKeys = args.bindings.map((b) =>
      b.kind === "workspace" ? `team:${b.id}` : `chan:${b.id}`,
    );

    if (args.platform === "slack") {
      if (!args.teamId) throw new Error("Slack workspace is required");
      const ownership = await ctx.db
        .query("chatKv")
        .withIndex("by_key", (q) =>
          q.eq("key", `slack:owner:${args.teamId}:${userId}`),
        )
        .first();
      if (!ownership) throw new Error("Slack workspace is not connected to this account");
    }

    // ── Collision checks ────────────────────────────────────
    // For each desired binding key, check whether ANY OTHER agent
    // already owns it. (Same agent re-binding is fine — that's the
    // idempotent case.)
    for (const channelBinding of bindingKeys) {
      const existing = await ctx.db
        .query("agentIntegrations")
        .withIndex("by_binding", (q) =>
          q.eq("channelBinding", channelBinding),
        )
        .take(10);

      const conflict = existing.find(
        (row) =>
          row.platform === args.platform && row.agentId !== args.agentId,
      );
      if (conflict) {
        const conflictAgent = await ctx.db.get(conflict.agentId);
        const name = conflictAgent?.name ?? "another agent";
        const where = channelBinding.startsWith("team:")
          ? "this Slack workspace"
          : "this Slack channel";
        throw new Error(
          `${name} is already responding in ${where}. Remove that binding first or pick a different scope.`,
        );
      }
    }

    // ── Insert or update bindings for THIS agent ────────────
    // Strategy: replace the agent's existing bindings for this platform
    // with the new set. This makes re-binding clean: re-running the
    // picker with different choices replaces the old choices entirely.
    const existing = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .take(20);

    const oldRows = existing.filter((row) => row.platform === args.platform);
    for (const row of oldRows) {
      await ctx.db.delete(row._id);
    }

    const insertedIds: string[] = [];
    for (const channelBinding of bindingKeys) {
      const id = await ctx.db.insert("agentIntegrations", {
        agentId: args.agentId,
        platform: args.platform,
        // Phase 1b: bot tokens live in chatKv via the Slack adapter's
        // setInstallation(). agentIntegrations only stores the binding.
        encryptedConfig: "",
        channelBinding,
      });
      insertedIds.push(id);
    }

    return { bindingsCreated: insertedIds.length };
  },
});

/**
 * Find an integration by platform + channelBinding, returning the
 * parent agent's runtime info needed by Chat SDK webhook handlers
 * to dispatch a message into OpenCode.
 *
 * Public mutation/query gated by the shared webhook secret — the
 * webhook handler runs on Vercel and has no Convex Auth session,
 * so it can't use `requireUserId`. Same pattern as `runs.logInternal`
 * and `convex/chatState.ts`.
 *
 * Returns null if no matching integration exists OR if the agent
 * has no provisioned sandbox yet. The Chat SDK handler must handle
 * the null case by posting a customer-friendly error message.
 */
export const findByBinding = query({
  args: {
    platform: v.string(),
    channelBinding: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWebhookSecret(args.secret);

    // Lookup by binding only (the index is by_binding); filter in
    // memory by platform. Multiple agents with the same binding for
    // different platforms is the only realistic collision shape, so
    // a small bounded read is fine.
    const candidates = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_binding", (q) =>
        q.eq("channelBinding", args.channelBinding),
      )
      .take(10);

    const match = candidates.find((c) => c.platform === args.platform);
    if (!match) return null;

    const agent = await ctx.db.get(match.agentId);
    if (!agent) return null;

    return {
      agentId: agent._id,
      agentName: agent.name,
      // Owner user id for the agent. The Slack/Telegram handlers use
      // this (NOT the chatter's platform id) as half of the Composio
      // identity `${userId}:${agentId}` — the agent's external tool
      // connections belong to the agent owner, not to whoever happens
      // to be chatting with it.
      userId: agent.userId,
      sandboxId: agent.sandboxId ?? null,
      serverPassword: agent.serverPassword ?? null,
      model: agent.model ?? null,
      persona: agent.persona ?? null,
      toolPermissions: agent.toolPermissions ?? null,
      composioToolkits: agent.composioToolkits ?? [],
      encryptedConfig: match.encryptedConfig,
    };
  },
});

/**
 * Look up integration config + parent agent runtime info by agentId
 * and platform. Secret-gated — used by the per-agent Telegram webhook
 * route to retrieve the bot token and agent sandbox details without
 * a Convex Auth session.
 */
export const getConfigInternal = query({
  args: {
    agentId: v.id("agents"),
    platform: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWebhookSecret(args.secret);

    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    const integrations = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .take(20);

    const match = integrations.find((i) => i.platform === args.platform);
    if (!match) return null;

    return {
      agentId: agent._id,
      agentName: agent.name,
      // See findByBinding — same contract.
      userId: agent.userId,
      sandboxId: agent.sandboxId ?? null,
      serverPassword: agent.serverPassword ?? null,
      model: agent.model ?? null,
      persona: agent.persona ?? null,
      toolPermissions: agent.toolPermissions ?? null,
      composioToolkits: agent.composioToolkits ?? [],
      encryptedConfig: match.encryptedConfig,
    };
  },
});

/**
 * Return the Chat SDK Slack bot token for an agent, looked up via
 * its Slack integration's workspace binding. Used by the sandbox
 * startup path to inject `SLACK_BOT_TOKEN` so the agent can search
 * Slack history and interact with the Slack Web API via the `bash`
 * tool — WITHOUT granting a second OAuth flow. Same bot identity
 * as Chat SDK uses for delivery.
 *
 * Returns `null` when:
 *   - The agent has no Slack integration at all
 *   - The integration is bound to a single channel (`chan:C…`)
 *     rather than a workspace (`team:T…`) — in that case we don't
 *     know which team's bot token to use without a separate lookup,
 *     and the sandbox just runs without a Slack token (the agent
 *     can still reply in Slack via Chat SDK's delivery path)
 *   - The workspace's bot token is missing from `chatKv` (e.g.,
 *     installation was revoked and not renewed)
 *
 * Webhook-secret protected — callable only from our Vercel runtime.
 */
export const getSlackBotTokenForAgent = query({
  args: {
    agentId: v.id("agents"),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWebhookSecret(args.secret);

    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    const integrations = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .take(20);
    const slack = integrations.find((i) => i.platform === "slack");
    if (!slack?.channelBinding?.startsWith("team:")) return null;
    const teamId = slack.channelBinding.slice("team:".length);

    const ownership = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) =>
        q.eq("key", `slack:owner:${teamId}:${agent.userId}`),
      )
      .first();
    if (!ownership) return null;

    const row = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) =>
        q.eq("key", `slack:installation:${teamId}`),
      )
      .first();
    if (!row) return null;
    const now = Date.now();
    if (row.expiresAt !== undefined && row.expiresAt <= now) return null;

    const value = row.value as { botToken?: string } | null;
    return value?.botToken ?? null;
  },
});

/**
 * Remove an integration.
 */
export const remove = mutation({
  args: { id: v.id("agentIntegrations") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);

    const integration = await ctx.db.get(id);
    if (!integration) throw new Error("Not found");

    const agent = await ctx.db.get(integration.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    await ctx.db.delete(id);
  },
});
