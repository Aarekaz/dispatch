import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";
import type { MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

async function getOrCreateProfile(ctx: MutationCtx, userId: string) {
  const existing = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("userProfiles", {
    userId,
    creditsBalance: 5000,
    subscriptionTier: "Pro",
  });
  return (await ctx.db.get(id))!;
}

export const deductInternal = mutation({
  args: {
    userId: v.string(),
    agentId: v.id("agents"),
    amount: v.number(),
    reason: v.string(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, userId, ...args }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      throw new Error("Forbidden");
    }

    await ctx.db.insert("creditLedger", {
      userId,
      agentId: args.agentId,
      amount: -args.amount,
      reason: args.reason,
      model: args.model,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      createdAt: Date.now(),
    });

    const profile = await getOrCreateProfile(ctx, userId);
    const current = profile.creditsBalance ?? 5000;
    await ctx.db.patch(profile._id, {
      creditsBalance: Math.max(0, current - args.amount),
    });
  },
});

export const checkInternal = query({
  args: { userId: v.string(), secret: v.string() },
  handler: async (ctx, { userId, secret }) => {
    if (!secret || secret !== process.env.CRON_INTERNAL_SECRET) {
      return { balance: 0 };
    }
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return { balance: profile?.creditsBalance ?? 0 };
  },
});

export const check = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return { balance: 0 };

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return { balance: profile?.creditsBalance ?? 5000 };
  },
});

/**
 * Real credit usage summary for the current user.
 *
 * Sums every negative entry in the creditLedger for this user since the
 * start of the current calendar month. Returns the total used + remaining
 * balance + the plan's monthly allowance so the settings page can show
 * a real progress bar instead of a hardcoded number.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) {
      return {
        used: 0,
        remaining: 0,
        total: 5000,
        costUsd: 0,
        byAgent: [] as Array<{ agentId: string; agentName: string; credits: number }>,
        byModel: [] as Array<{ model: string; credits: number }>,
      };
    }

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const remaining = profile?.creditsBalance ?? 5000;
    const total = 5000; // monthly allowance — will read from plan/subscriptionTier later

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startMs = startOfMonth.getTime();

    // Use by_user_and_createdAt index to only read THIS month's entries,
    // not the entire ledger history. Without this, .collect() reads every
    // entry since account creation — unbounded and degrading over time.
    const entries = await ctx.db
      .query("creditLedger")
      .withIndex("by_user_and_createdAt", (q) =>
        q.eq("userId", userId).gte("createdAt", startMs),
      )
      .take(5000); // defensive cap

    const monthEntries = entries.filter((e) => e.amount < 0);

    const used = monthEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
    // Convert back to USD: 1 credit = $0.001
    const costUsd = used / 1000;

    // Per-agent breakdown
    const agentMap = new Map<string, number>();
    for (const e of monthEntries) {
      if (e.agentId) {
        agentMap.set(
          e.agentId,
          (agentMap.get(e.agentId) ?? 0) + Math.abs(e.amount),
        );
      }
    }
    // Resolve agent names
    const byAgent = await Promise.all(
      Array.from(agentMap.entries()).map(async ([agentId, credits]) => {
        const agent = await ctx.db.get(agentId as Id<"agents">);
        return {
          agentId,
          agentName: agent?.name ?? "Deleted agent",
          credits,
        };
      }),
    );
    byAgent.sort((a, b) => b.credits - a.credits);

    // Per-model breakdown
    const modelMap = new Map<string, number>();
    for (const e of monthEntries) {
      const model = e.model ?? "unknown";
      modelMap.set(model, (modelMap.get(model) ?? 0) + Math.abs(e.amount));
    }
    const byModel = Array.from(modelMap.entries())
      .map(([model, credits]) => ({ model, credits }))
      .sort((a, b) => b.credits - a.credits);

    return { used, remaining, total, costUsd, byAgent, byModel };
  },
});

/**
 * Deduct credits for a completed run — secret-gated for webhook handlers.
 *
 * Resolves the user from the agent's `userId` field, converts costUsd to
 * credits (1 credit = $0.001, i.e. 1000 credits per dollar), writes a
 * ledger entry, and decrements the user's balance.
 *
 * Called from both the Slack handler and the web chat route after a
 * successful run. Idempotent-ish: if called twice for the same run,
 * it'll create two ledger entries. Callers must ensure single-call.
 */
export const deductForRun = mutation({
  args: {
    agentId: v.id("agents"),
    costUsd: v.number(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
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

    // Skip zero-cost runs (e.g., cached responses, errors).
    if (args.costUsd <= 0) return;

    // Convert: 1 credit = $0.001 → credits = costUsd * 1000
    const credits = Math.ceil(args.costUsd * 1000);

    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;

    await ctx.db.insert("creditLedger", {
      userId: agent.userId,
      agentId: args.agentId,
      amount: -credits,
      reason: "run",
      model: args.model,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      createdAt: Date.now(),
    });

    const profile = await getOrCreateProfile(ctx, agent.userId);
    const current = profile.creditsBalance ?? 5000;
    await ctx.db.patch(profile._id, {
      creditsBalance: Math.max(0, current - credits),
    });
  },
});

/**
 * Deduct credits after a run completes.
 * Writes a ledger entry and decrements user balance.
 */
export const deduct = mutation({
  args: {
    agentId: v.id("agents"),
    amount: v.number(),
    reason: v.string(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    // Write ledger entry
    await ctx.db.insert("creditLedger", {
      userId,
      agentId: args.agentId,
      amount: -args.amount,
      reason: args.reason,
      model: args.model,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      createdAt: Date.now(),
    });

    const profile = await getOrCreateProfile(ctx, userId);
    const current = profile.creditsBalance ?? 5000;
    await ctx.db.patch(profile._id, {
      creditsBalance: Math.max(0, current - args.amount),
    });
  },
});
