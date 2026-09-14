import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";
import { Id } from "./_generated/dataModel";

/**
 * Log a run without user auth — secret-gated for internal callers
 * that have no Convex Auth session.
 *
 * Accepts EITHER of two secrets for backwards compatibility:
 *   - CRON_INTERNAL_SECRET          — the original caller (cron dispatcher)
 *   - CHAT_STATE_INTERNAL_SECRET    — Chat SDK webhook handlers (lib/chat/handlers/*)
 *
 * Both env vars represent the same trust boundary ("a Vercel runtime
 * function is calling us directly, not a logged-in user"), so they're
 * treated as equivalent here. If either matches, the call is authorized.
 */
export const logInternal = mutation({
  args: {
    agentId: v.id("agents"),
    sessionId: v.optional(v.string()),
    trigger: v.union(v.literal("chat"), v.literal("cron"), v.literal("webhook"), v.literal("manual"), v.literal("automation")),
    channel: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.string()),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    credits: v.optional(v.number()),
    duration: v.optional(v.string()),
    // Failure diagnostics — see `lib/chat/errors.ts` and the
    // schema comment on agentRuns. Only set when status === "failed".
    errorCategory: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    // Automation attribution — set when trigger === "automation"
    automationId: v.optional(v.id("agentAutomations")),
    automationName: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }) => {
    const cronSecret = process.env.CRON_INTERNAL_SECRET;
    const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET;
    const isValid =
      !!secret &&
      ((cronSecret !== undefined && secret === cronSecret) ||
        (chatSecret !== undefined && secret === chatSecret));
    if (!isValid) {
      throw new Error("Forbidden");
    }
    return await ctx.db.insert("agentRuns", {
      ...args,
      startedAt: Date.now(),
    });
  },
});

export const log = mutation({
  args: {
    agentId: v.id("agents"),
    sessionId: v.optional(v.string()),
    trigger: v.union(v.literal("chat"), v.literal("cron"), v.literal("webhook"), v.literal("manual"), v.literal("automation")),
    channel: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.string()),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    credits: v.optional(v.number()),
    duration: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    return await ctx.db.insert("agentRuns", {
      ...args,
      startedAt: Date.now(),
    });
  },
});

export const logFromAction = internalMutation({
  args: {
    agentId: v.id("agents"),
    sessionId: v.optional(v.string()),
    trigger: v.union(v.literal("chat"), v.literal("cron"), v.literal("webhook"), v.literal("manual"), v.literal("automation")),
    channel: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.string()),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    credits: v.optional(v.number()),
    duration: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      ...args,
      startedAt: Date.now(),
    });
  },
});

/**
 * List runs for an agent, newest first. Each row is enriched with the
 * session title (when one exists) so the manage-page Activity section
 * has a meaningful action line without relying on `summary` being set.
 */
export const list = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) return [];

    // The Activity page does its own client-side pagination (25/page
    // in the TanStack table) so this cap is just "how far back are
    // we willing to scan". 50 was too tight — once an agent crosses
    // 50 lifetime runs, new runs replace old ones inside the window
    // and the filter-tab counts appear frozen at 50 even as activity
    // grows.
    //
    // 1000 gives a comfortable buffer (months of daily use on one
    // agent) and still sits well under Convex's 8 MB response ceiling
    // (~300 B per trimmed run × 1000 ≈ 300 KB). If we ever hit the
    // cap for real, switch this query to `.paginate()` with cursor
    // pagination and expose a separate count query for the filter
    // tabs.
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .take(1000);

    // Look up session title for each run that has a sessionId. Same
    // pattern as recentForUser — small per-row cost, big UX win.
    return await Promise.all(
      runs.map(async (run) => {
        let sessionTitle: string | null = null;
        if (run.sessionId) {
          const sessionId = run.sessionId;
          const session = await ctx.db
            .query("agentSessions")
            .withIndex("by_agent_session", (q) =>
              q.eq("agentId", agentId).eq("sessionExternalId", sessionId),
            )
            .unique();
          sessionTitle = session?.title ?? null;
        }
        return { ...run, sessionTitle };
      }),
    );
  },
});

/**
 * Recent runs across ALL of the user's agents, newest first.
 *
 * Powers the home page's supervision feed. Returns customer-facing
 * runs only — cron / manual / internal automation runs are excluded.
 *
 * Channel inference: pre-existing runs were created before the
 * `channel` field migration, so they have channel: null in the DB.
 * But trigger: "chat" definitionally means a web chat, even on
 * pre-migration rows. Inferring channel: "web" for chat-triggered
 * runs (and "webhook" until Phase 3 channel handlers land) keeps
 * them visible in the supervision feed instead of silently dropping
 * them. New runs (post-9663ea0) have channel set explicitly and
 * pass through unchanged.
 *
 * Note: this fetches `limit * 2` per agent to give the deduper room
 * to collapse multi-turn sessions into single rows on the client.
 * Fine for users with up to ~50 agents. For larger scale, denormalize
 * a `userId` field onto agentRuns and add a `by_user_recent` index.
 */
export const recentForUser = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200);

    if (agents.length === 0) return [];

    // Fetch a larger window per agent so the client deduper has
    // room to collapse multi-turn sessions into single rows.
    const fetchPerAgent = limit * 5;

    const perAgent = await Promise.all(
      agents.map(async (agent) => {
        const runs = await ctx.db
          .query("agentRuns")
          .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
          .order("desc")
          .take(fetchPerAgent);
        return await Promise.all(
          runs.map(async (run) => {
            let sessionTitle: string | null = null;
            if (run.sessionId) {
              const sessionId = run.sessionId;
              const session = await ctx.db
                .query("agentSessions")
                .withIndex("by_agent_session", (q) =>
                  q.eq("agentId", agent._id).eq("sessionExternalId", sessionId),
                )
                .unique();
              sessionTitle = session?.title ?? null;
            }
            return {
              id: run._id,
              agentId: agent._id,
              agentName: agent.name,
              sessionId: run.sessionId ?? null,
              sessionTitle,
              channel: resolveChannel(run.channel, run.trigger),
              trigger: run.trigger,
              status: run.status,
              summary: run.summary ?? null,
              startedAt: run.startedAt,
            };
          }),
        );
      }),
    );

    return perAgent
      .flat()
      .filter((run) => run.channel !== null) // exclude cron / manual
      .sort((a, b) => b.startedAt - a.startedAt);
  },
});

/**
 * All runs for the logged-in user's agents, newest first.
 *
 * Powers the `/events` page — the workspace-wide activity log.
 * Unlike `recentForUser` this returns EVERY run (cron, manual,
 * internal), includes full error diagnostic fields, and surfaces
 * all available metrics so the events page can display maximum
 * detail. Optional `agentId` filter supports the `?agentId=`
 * scoping link from the per-agent Activity section.
 */
export const allForUser = query({
  args: {
    limit: v.optional(v.number()),
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, { limit = 100, agentId }) => {
    const cappedLimit = Math.min(limit, 200);
    const userId = await getUserId(ctx);
    if (!userId) return [];

    // If agentId is provided, scope to that single agent (after
    // verifying ownership). Otherwise fetch all the user's agents.
    let agents;
    if (agentId) {
      const agent = await ctx.db.get(agentId as Id<"agents">);
      if (!agent || agent.userId !== userId) return [];
      agents = [agent];
    } else {
      agents = await ctx.db
        .query("agents")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(200);
    }
    if (agents.length === 0) return [];

    const perAgent = await Promise.all(
      agents.map(async (agent) => {
        const runs = await ctx.db
          .query("agentRuns")
          .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
          .order("desc")
          .take(cappedLimit);
        return await Promise.all(
          runs.map(async (run) => {
            let sessionTitle: string | null = null;
            if (run.sessionId) {
              const session = await ctx.db
                .query("agentSessions")
                .withIndex("by_agent_session", (q) =>
                  q.eq("agentId", agent._id).eq("sessionExternalId", run.sessionId!),
                )
                .unique();
              sessionTitle = session?.title ?? null;
            }
            return {
              id: run._id,
              agentId: agent._id,
              agentName: agent.name,
              agentEmoji: agent.emoji ?? null,
              sessionId: run.sessionId ?? null,
              sessionTitle,
              channel: resolveChannel(run.channel, run.trigger),
              trigger: run.trigger,
              status: run.status,
              summary: run.summary ?? null,
              model: run.model ?? null,
              tokensIn: run.tokensIn ?? 0,
              tokensOut: run.tokensOut ?? 0,
              credits: run.credits ?? 0,
              duration: run.duration ?? null,
              startedAt: run.startedAt,
              errorCategory: run.errorCategory ?? null,
              errorDetail: run.errorDetail ?? null,
              correlationId: run.correlationId ?? null,
            };
          }),
        );
      }),
    );

    return perAgent.flat().sort((a, b) => b.startedAt - a.startedAt);
  },
});

/**
 * Resolve a run's display channel:
 * - explicit channel field wins (post-migration runs)
 * - chat / webhook triggers infer "web" (pre-migration backfill,
 *   correct for current state since webhooks only fire from web today)
 * - cron / manual stay null and get filtered out of customer feeds
 */
function resolveChannel(
  channel: string | undefined,
  trigger: string,
): string | null {
  if (channel) return channel;
  if (trigger === "chat" || trigger === "webhook") return "web";
  return null;
}
