import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Shared validators ───────────────────────────────────
// Single source of truth for the delivery type union — used in
// create args, update args, and referenced by the schema.
const deliveryTypeValidator = v.union(
  v.literal("activity_log"),
  v.literal("slack_channel"),
  v.literal("telegram_channel"),
  v.literal("slack_thread"),
);

const deliveryValidator = v.optional(
  v.object({
    type: deliveryTypeValidator,
    config: v.optional(v.any()),
  }),
);

// ── Helpers ──────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "untitled";
}

// ── Public queries (auth-gated) ─────────────────────────

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const automations = await ctx.db
      .query("agentAutomations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    // Batch-fetch unique agents (avoids N+1 — 50 automations across
    // 3 agents = 3 reads instead of 50)
    const uniqueAgentIds = [...new Set(automations.map((a) => a.agentId))];
    const agentMap = new Map<string, { name: string; emoji?: string; composioToolkits?: string[] }>();
    await Promise.all(
      uniqueAgentIds.map(async (id) => {
        const agent = await ctx.db.get(id);
        if (agent) {
          agentMap.set(id, {
            name: agent.name,
            emoji: agent.emoji,
            composioToolkits: agent.composioToolkits,
          });
        }
      }),
    );

    return automations.map((a) => {
      const agent = agentMap.get(a.agentId);
      return {
        ...a,
        agentName: agent?.name ?? "Unknown",
        agentEmoji: agent?.emoji ?? null,
        composioToolkits: agent?.composioToolkits ?? [],
      };
    });
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) return [];

    return await ctx.db
      .query("agentAutomations")
      .withIndex("by_agent_and_slug", (q) => q.eq("agentId", agentId))
      .take(100);
  },
});

export const get = query({
  args: { id: v.id("agentAutomations") },
  handler: async (ctx, { id }) => {
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const automation = await ctx.db.get(id);
    if (!automation || automation.userId !== userId) return null;

    const agent = await ctx.db.get(automation.agentId);

    // Fetch the agent's channel integrations so the delivery picker
    // can show only platforms the agent is actually connected to.
    const integrations = agent
      ? await ctx.db
          .query("agentIntegrations")
          .withIndex("by_agent", (q) => q.eq("agentId", automation.agentId))
          .take(20)
      : [];

    const connectedPlatforms = integrations.map((i) => ({
      platform: i.platform,
      channelBinding: i.channelBinding ?? null,
    }));

    return {
      ...automation,
      agentName: agent?.name ?? "Unknown",
      agentEmoji: agent?.emoji ?? null,
      composioToolkits: agent?.composioToolkits ?? [],
      connectedPlatforms,
    };
  },
});

// ── Public mutations (auth-gated) ───────────────────────

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    instructions: v.string(),
    schedules: v.optional(
      v.array(
        v.object({
          id: v.string(),
          cron: v.string(),
          timezone: v.string(),
        }),
      ),
    ),
    triggers: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.string(),
          label: v.optional(v.string()),
          config: v.any(),
        }),
      ),
    ),
    allowedToolkits: v.optional(v.array(v.string())),
    defaultDelivery: deliveryValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const slug = slugify(args.name);

    return await ctx.db.insert("agentAutomations", {
      agentId: args.agentId,
      userId,
      name: args.name,
      slug,
      enabled: true,
      schedules: args.schedules ?? [],
      triggers: args.triggers ?? [],
      instructions: args.instructions,
      allowedToolkits: args.allowedToolkits,
      defaultDelivery: args.defaultDelivery ?? { type: "activity_log" },
      runCount: 0,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("agentAutomations"),
    name: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    agentId: v.optional(v.id("agents")),
    instructions: v.optional(v.string()),
    schedules: v.optional(
      v.array(
        v.object({
          id: v.string(),
          cron: v.string(),
          timezone: v.string(),
        }),
      ),
    ),
    triggers: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.string(),
          label: v.optional(v.string()),
          config: v.any(),
        }),
      ),
    ),
    allowedToolkits: v.optional(v.array(v.string())),
    defaultDelivery: deliveryValidator,
    nextScheduleAt: v.optional(v.number()),
    persistentSessionId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await requireUserId(ctx);

    const automation = await ctx.db.get(id);
    if (!automation || automation.userId !== userId) throw new Error("Not found");

    // If changing agent, verify ownership of the new agent
    if (fields.agentId) {
      const newAgent = await ctx.db.get(fields.agentId);
      if (!newAgent || newAgent.userId !== userId) throw new Error("Not found");
    }

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }

    // Regenerate slug if name changed
    if (fields.name) {
      updates.slug = slugify(fields.name);
    }

    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("agentAutomations") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);

    const automation = await ctx.db.get(id);
    if (!automation || automation.userId !== userId) throw new Error("Not found");

    // Delegate to internal function for the actual deletion + self-scheduling
    await deleteAutomationRuns(ctx, id);
  },
});

/**
 * Internal helper: batch-delete runs then delete the automation.
 * Self-schedules if >500 runs to stay within transaction limits.
 * Uses `internal.` reference (not `api.`) per Convex best practices.
 */
async function deleteAutomationRuns(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  id: Id<"agentAutomations">,
) {
  const runs = await ctx.db
    .query("agentAutomationRuns")
    .withIndex("by_automation", (q) => q.eq("automationId", id))
    .take(500);
  for (const run of runs) {
    await ctx.db.delete(run._id);
  }
  if (runs.length === 500) {
    await ctx.scheduler.runAfter(
      0,
      internal.agentAutomations.continueDelete,
      { id },
    );
    return;
  }
  await ctx.db.delete(id);
}

/** Internal continuation for batched deletion — not exposed as public API. */
export const continueDelete = internalMutation({
  args: { id: v.id("agentAutomations") },
  handler: async (ctx, { id }) => {
    await deleteAutomationRuns(ctx, id);
  },
});

// ── Dispatcher queries (secret-gated, no user auth) ─────

/**
 * Automations with schedules that are due to fire.
 * Called by /api/cron/tick every minute.
 */
export const listDueSchedules = query({
  args: { now: v.number(), secret: v.string() },
  handler: async (ctx, { now, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) return [];

    return await ctx.db
      .query("agentAutomations")
      .withIndex("by_enabled_and_nextSchedule", (q) =>
        q.eq("enabled", true).lte("nextScheduleAt", now),
      )
      .take(10);
  },
});

/**
 * Automations with channel_scanner triggers that are due for a scan.
 * Called by /api/cron/tick periodically (checks cadence internally).
 */
export const listScannerAutomations = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) return [];

    // Fetch all enabled automations — the dispatcher filters by
    // trigger type and scan cadence on the Next.js side, since
    // Convex can't index into array elements.
    const all = await ctx.db
      .query("agentAutomations")
      .withIndex("by_enabled_and_nextSchedule", (q) =>
        q.eq("enabled", true),
      )
      .take(200);

    return all.filter((a) =>
      a.triggers.some((t) => t.type === "slack.channel_scanner"),
    );
  },
});

/**
 * Mark a schedule-triggered automation as run.
 */
export const markScheduleRun = mutation({
  args: {
    id: v.id("agentAutomations"),
    nextScheduleAt: v.number(),
    status: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { id, nextScheduleAt, status, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      throw new Error("Forbidden");
    }
    await ctx.db.patch(id, {
      lastRunAt: Date.now(),
      lastRunStatus: status as "success" | "failed" | "skipped",
      nextScheduleAt,
      runCount: ((await ctx.db.get(id))?.runCount ?? 0) + 1,
    });
  },
});

/**
 * Update scanner bookkeeping after a scan pass.
 */
export const markScannerRun = mutation({
  args: {
    id: v.id("agentAutomations"),
    triggerId: v.string(),
    lastScanAt: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, { id, triggerId, lastScanAt, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      throw new Error("Forbidden");
    }
    const automation = await ctx.db.get(id);
    if (!automation) return;

    const scanTimes = (automation.scannerLastScanAt as Record<string, number>) ?? {};
    scanTimes[triggerId] = lastScanAt;

    await ctx.db.patch(id, {
      scannerLastScanAt: scanTimes,
      lastRunAt: Date.now(),
    });
  },
});

/**
 * Save the persistent session ID on an automation — secret-gated.
 * Called from invoke.ts on first run so subsequent runs reuse the
 * same OpenCode session (giving the agent memory across runs).
 */
export const savePersistentSession = mutation({
  args: {
    id: v.id("agentAutomations"),
    persistentSessionId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { id, persistentSessionId, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      throw new Error("Forbidden");
    }
    await ctx.db.patch(id, { persistentSessionId });
  },
});

/**
 * Get an automation by ID without user auth — secret-gated for
 * the cron dispatcher and automation invoke path.
 */
export const getInternal = query({
  args: { id: v.id("agentAutomations"), secret: v.string() },
  handler: async (ctx, { id, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) return null;
    return await ctx.db.get(id);
  },
});

// `api` import removed — all scheduling now uses `internal.`
