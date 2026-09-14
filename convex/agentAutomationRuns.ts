import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId } from "./authHelpers";

/**
 * Log an automation run — secret-gated for the dispatcher.
 * Also increments the parent automation's runCount.
 */
export const log = mutation({
  args: {
    automationId: v.id("agentAutomations"),
    agentId: v.id("agents"),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    triggerKind: v.union(
      v.literal("manual"),
      v.literal("schedule"),
      v.literal("trigger"),
    ),
    triggerDetail: v.optional(v.string()),
    delivery: v.optional(
      v.object({
        type: v.union(v.literal("activity_log"), v.literal("slack_channel"), v.literal("telegram_channel"), v.literal("slack_thread")),
        config: v.optional(v.any()),
      }),
    ),
    output: v.optional(v.string()),
    summary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }) => {
    const cronSecret = process.env.CRON_INTERNAL_SECRET;
    const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET;
    const isValid =
      !!secret &&
      ((cronSecret !== undefined && secret === cronSecret) ||
        (chatSecret !== undefined && secret === chatSecret));
    if (!isValid) throw new Error("Forbidden");

    const runId = await ctx.db.insert("agentAutomationRuns", {
      ...args,
      startedAt: Date.now(),
      completedAt: args.status !== "running" ? Date.now() : undefined,
    });

    // Increment parent runCount + update status
    if (args.status !== "running") {
      const automation = await ctx.db.get(args.automationId);
      if (automation) {
        await ctx.db.patch(args.automationId, {
          runCount: (automation.runCount ?? 0) + 1,
          lastRunAt: Date.now(),
          lastRunStatus: args.status === "success" ? "success" : "failed",
        });
      }
    }

    return runId;
  },
});

/**
 * Complete a running run — called when invocation finishes.
 */
export const complete = mutation({
  args: {
    runId: v.id("agentAutomationRuns"),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    output: v.optional(v.string()),
    summary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { runId, secret, ...fields }) => {
    const cronSecret = process.env.CRON_INTERNAL_SECRET;
    const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET;
    const isValid =
      !!secret &&
      ((cronSecret !== undefined && secret === cronSecret) ||
        (chatSecret !== undefined && secret === chatSecret));
    if (!isValid) throw new Error("Forbidden");

    const run = await ctx.db.get(runId);
    if (!run) return;

    await ctx.db.patch(runId, {
      ...fields,
      completedAt: Date.now(),
    });

    // Update parent automation status (don't increment runCount —
    // that's already done in `log` when the run is first created)
    await ctx.db.patch(run.automationId, {
      lastRunAt: Date.now(),
      lastRunStatus: fields.status === "success" ? "success" : "failed",
    });
  },
});

/**
 * List recent runs for an automation (auth-gated).
 */
export const list = query({
  args: {
    automationId: v.id("agentAutomations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { automationId, limit = 10 }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const automation = await ctx.db.get(automationId);
    if (!automation || automation.userId !== userId) return [];

    return await ctx.db
      .query("agentAutomationRuns")
      .withIndex("by_automation_and_startedAt", (q) =>
        q.eq("automationId", automationId),
      )
      .order("desc")
      .take(Math.min(limit, 50));
  },
});

/**
 * List recent runs — secret-gated for the cron/scanner path.
 * The scanner needs this to dedupe already-processed messages.
 */
export const listInternal = query({
  args: {
    automationId: v.id("agentAutomations"),
    limit: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { automationId, limit = 50, secret }) => {
    const cronSecret = process.env.CRON_INTERNAL_SECRET;
    if (!secret || secret !== cronSecret) return [];

    return await ctx.db
      .query("agentAutomationRuns")
      .withIndex("by_automation_and_startedAt", (q) =>
        q.eq("automationId", automationId),
      )
      .order("desc")
      .take(Math.min(limit, 100));
  },
});

/**
 * Cleanup old runs — secret-gated, called from cron tick.
 * Deletes runs older than the retention period (30 days).
 */
export const cleanup = mutation({
  args: {
    olderThanMs: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, { olderThanMs, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      throw new Error("Forbidden");
    }

    const cutoff = Date.now() - olderThanMs;
    // Bounded full-table scan — no index predicate because cleanup spans
    // ALL automations. Ordering "asc" ensures oldest rows come first, and
    // .take(100) caps the scan so a single tick never times out. Repeated
    // cron invocations drain the backlog progressively.
    const old = await ctx.db
      .query("agentAutomationRuns")
      .order("asc")
      .take(100);

    let deleted = 0;
    for (const run of old) {
      if (run.startedAt < cutoff) {
        await ctx.db.delete(run._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
