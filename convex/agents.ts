import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);

    // Join connected channels from agentIntegrations for each agent.
    // Every agent is reachable on the website chat by default, so "web"
    // is always prepended to the channels array. External integrations
    // (slack/whatsapp/etc.) are layered on top.
    //
    // Also enriches each agent with two real activity stats from agentRuns:
    //   - lastActiveAt: timestamp of the most recent run (for "X ago" display)
    //   - runCountToday: number of runs since start of today (for activity badge)
    // Both replace the previously hardcoded "just now" / 0 placeholders.
    const startOfTodayMs = startOfTodayUtc();

    return await Promise.all(
      agents.map(async (a) => {
        const vertical = a.vertical ?? "General";
        const integrations = await ctx.db
          .query("agentIntegrations")
          .withIndex("by_agent", (q) => q.eq("agentId", a._id))
          .take(20);

        // Most recent run (1 row)
        const mostRecent = await ctx.db
          .query("agentRuns")
          .withIndex("by_agent", (q) => q.eq("agentId", a._id))
          .order("desc")
          .first();

        // Today's runs — fetched bounded so we don't pull the full history
        // for active agents. 100 runs/day is a comfortable upper bound for
        // the count display; anything past that is still "100+" worth.
        const todayRuns = await ctx.db
          .query("agentRuns")
          .withIndex("by_agent", (q) => q.eq("agentId", a._id))
          .order("desc")
          .take(100);
        const runCountToday = todayRuns.filter(
          (r) => r.startedAt >= startOfTodayMs,
        ).length;

        return {
          id: a._id,
          name: a.name,
          slug: a.slug,
          pack: vertical,
          vertical,
          status: a.status,
          model: a.model,
          lastActiveAt: mostRecent?.startedAt ?? null,
          runCountToday,
          channels: ["web", ...integrations.map((i) => i.platform)],
          summary: "",
          emoji: a.emoji,
          tasksRunning: 0,
          email: a.email,
          endpoint: a.endpoint,
        };
      }),
    );
  },
});

function startOfTodayUtc(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Get a single agent by ID.
 */
export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) return null;

    const integrations = await ctx.db
      .query("agentIntegrations")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .take(20);
    const vertical = agent.vertical ?? "General";

    return {
      id: agent._id,
      // Agent owner's Convex user id. Exposed so the chat route can pass
      // it to ensureAgentRunning → getComposioMcpConfig without a second
      // auth round-trip. Never trust a client-supplied userId — always
      // source it from this projection (or from resolveAgentForThread
      // on the Slack/Telegram path).
      userId: agent.userId,
      name: agent.name,
      slug: agent.slug,
      pack: vertical,
      vertical,
      status: agent.status,
      model: agent.model,
      // Every agent is reachable on web by default; externals layer on top.
      channels: ["web", ...integrations.map((i) => i.platform)],
      summary: "",
      emoji: agent.emoji,
      persona: agent.persona,
      toolPermissions: agent.toolPermissions,
      // Composio toolkit slugs. Default to [] for older rows that predate
      // the field so callers can treat it as always present.
      composioToolkits: agent.composioToolkits ?? [],
      tasksRunning: 0,
      email: agent.email,
      endpoint: agent.endpoint,
      sandboxId: agent.sandboxId,
      volumeId: agent.volumeId,
      serverPassword: agent.serverPassword,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    vertical: v.string(),
    model: v.string(),
    emoji: v.optional(v.string()),
    persona: v.optional(v.string()),
    toolPermissions: v.optional(v.union(v.literal("conservative"), v.literal("balanced"), v.literal("permissive"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const maxAgents = Math.max(1, Number(process.env.MAX_AGENTS_PER_USER ?? "3"));
    const existingAgents = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(maxAgents);
    if (existingAgents.length >= maxAgents) {
      throw new Error(`Agent limit reached (${maxAgents} per account)`);
    }

    return await ctx.db.insert("agents", {
      userId,
      name: args.name,
      slug: args.slug,
      vertical: args.vertical,
      model: args.model,
      status: "draft",
      emoji: args.emoji,
      persona: args.persona,
      toolPermissions: args.toolPermissions,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    model: v.optional(v.string()),
    vertical: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("idle"),
        v.literal("draft"),
        v.literal("attention"),
      ),
    ),
    emoji: v.optional(v.string()),
    persona: v.optional(v.string()),
    email: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    toolPermissions: v.optional(v.union(v.literal("conservative"), v.literal("balanced"), v.literal("permissive"))),
    // Composio toolkit slugs. Written via the filter-undefined loop below,
    // so passing `undefined` leaves the existing value alone. Pass an
    // empty array to explicitly disable all Composio tools.
    composioToolkits: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }

    await ctx.db.patch(id, updates);
  },
});

/**
 * Atomically add a Composio toolkit slug to the agent's enabled list.
 *
 * Unlike `update({ composioToolkits })`, this reads the current list
 * INSIDE the transaction and merges set-style, so two concurrent
 * Connect clicks on different toolkits can't silently clobber each
 * other. Convex's optimistic concurrency control handles ordering —
 * the second transaction sees the first's write and merges on top.
 *
 * No-op if the slug is already present.
 */
export const addToolkit = mutation({
  args: { id: v.id("agents"), toolkit: v.string() },
  handler: async (ctx, { id, toolkit }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const current = agent.composioToolkits ?? [];
    if (current.includes(toolkit)) return;

    await ctx.db.patch(id, {
      composioToolkits: [...current, toolkit],
    });
  },
});

/**
 * Atomically remove a Composio toolkit slug from the agent's enabled
 * list. Mirror of `addToolkit` — same OCC story, same no-op semantics
 * when the slug isn't in the list.
 */
export const removeToolkit = mutation({
  args: { id: v.id("agents"), toolkit: v.string() },
  handler: async (ctx, { id, toolkit }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const current = agent.composioToolkits ?? [];
    if (!current.includes(toolkit)) return;

    await ctx.db.patch(id, {
      composioToolkits: current.filter((s) => s !== toolkit),
    });
  },
});

/**
 * Store Daytona sandbox info after provisioning (Phase 2).
 */
export const updateSandboxInfo = mutation({
  args: {
    id: v.id("agents"),
    sandboxId: v.string(),
    volumeId: v.string(),
    serverPassword: v.string(),
  },
  handler: async (ctx, { id, ...info }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    await ctx.db.patch(id, info);
  },
});

export const getInternal = query({
  args: { id: v.id("agents"), secret: v.string() },
  handler: async (ctx, { id, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) return null;
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(id);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    await ctx.db.delete(id);
  },
});
