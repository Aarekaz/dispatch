import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";
import { createThread } from "@convex-dev/agent";
import { components } from "./_generated/api";

/**
 * Shared secret check for webhook-callable mutations. Same env var
 * as `convex/chatState.ts`, `convex/integrations.ts:findByBinding`,
 * and `convex/chat.ts:persistMessagesFromWebhook`.
 */
function requireWebhookSecret(secret: string): void {
  if (!secret || secret !== process.env.CHAT_STATE_INTERNAL_SECRET) {
    throw new Error("Forbidden — invalid webhook secret");
  }
}

/** Accepts either CRON_INTERNAL_SECRET or CHAT_STATE_INTERNAL_SECRET. */
function requireInternalSecret(secret: string): void {
  const cronSecret = process.env.CRON_INTERNAL_SECRET;
  const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET;
  const isValid =
    !!secret &&
    ((cronSecret !== undefined && secret === cronSecret) ||
      (chatSecret !== undefined && secret === chatSecret));
  if (!isValid) throw new Error("Forbidden");
}

/**
 * List sessions for an agent (reactive subscription).
 */
export const list = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) return [];

    // Bounded to 200 — use pagination if agents accumulate more sessions.
    return await ctx.db
      .query("agentSessions")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .take(200);
  },
});

export const upsert = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { agentId, sessionExternalId, title }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_agent_session", (q) =>
        q.eq("agentId", agentId).eq("sessionExternalId", sessionExternalId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(title !== undefined ? { title } : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentSessions", {
      agentId,
      sessionExternalId,
      title,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Webhook-callable variant of `upsert`. No user-auth check — the
 * Vercel webhook handler that invokes this has no Convex Auth
 * session, so authorization is enforced by the shared secret.
 *
 * Used by `lib/chat/handlers/message.ts` after a Chat SDK platform
 * handler completes a turn, so the Activity feed on
 * `/[agentId]/activity` shows the actual user message text instead
 * of falling through to the generic "Handled a Slack conversation."
 * placeholder.
 *
 * **externalThreadId** — optional platform thread ID (e.g. the Chat
 * SDK `thread.id` string like `slack:C123:1699999.000001`). Stored
 * in the existing `threadId` field so the session can be recovered
 * by `getByExternalThread` after Chat SDK's 30-day `thread.state`
 * TTL evicts the hot-path `opencodeSessionId` cache. The `threadId`
 * field is already indexed (`by_thread`) and semantically distinct
 * from the Convex agent-component thread UUIDs used by the web chat
 * path — the two formats don't collide.
 */
export const upsertFromWebhook = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    title: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (
    ctx,
    { agentId, sessionExternalId, title, externalThreadId, secret },
  ) => {
    requireWebhookSecret(secret);

    const existing = await ctx.db
      .query("agentSessions")
      .withIndex("by_agent_session", (q) =>
        q.eq("agentId", agentId).eq("sessionExternalId", sessionExternalId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(title !== undefined ? { title } : {}),
        ...(externalThreadId !== undefined
          ? { threadId: externalThreadId }
          : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentSessions", {
      agentId,
      sessionExternalId,
      title,
      threadId: externalThreadId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Look up a session by (agentId, externalThreadId) — the persistent
 * fallback for recovering OpenCode session IDs after Chat SDK's
 * 30-day `thread.state` TTL evicts the hot-path cache.
 *
 * Call path (from `lib/chat/handlers/message.ts`):
 *   1. Try `thread.state.opencodeSessionId` (in-memory + Convex
 *      micro-cache, sub-100ms).
 *   2. MISS → try this query (one Convex round-trip).
 *   3. MISS → create a fresh OpenCode session and upsert via
 *      `upsertFromWebhook` with the same `externalThreadId`.
 *
 * Secret-gated because it's called from a Vercel webhook runtime
 * with no Convex Auth session — same pattern as `findByBinding`,
 * `runs.logInternal`, and all `chatState.*` functions.
 *
 * Returns `null` when no row matches OR when the matched row belongs
 * to a different agent (defensive — should not happen given the
 * agent-scoped query, but the filter keeps the contract tight).
 */
export const getByExternalThread = query({
  args: {
    agentId: v.id("agents"),
    externalThreadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { agentId, externalThreadId, secret }) => {
    requireWebhookSecret(secret);

    // `by_thread` is a single-field index on `threadId`. Multiple agents
    // could theoretically share an external thread id (unlikely but not
    // impossible), so we take a bounded slice and filter by agentId.
    const candidates = await ctx.db
      .query("agentSessions")
      .withIndex("by_thread", (q) => q.eq("threadId", externalThreadId))
      .take(10);

    const match = candidates.find((row) => row.agentId === agentId);
    if (!match) return null;

    return {
      sessionExternalId: match.sessionExternalId,
      title: match.title,
      updatedAt: match.updatedAt,
    };
  },
});

/**
 * Update session metadata by threadId.
 * Called from API route's onFinish after stream completes.
 */
export const updateByThread = mutation({
  args: {
    threadId: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, { threadId, updatedAt }) => {
    await requireUserId(ctx);

    const session = await ctx.db
      .query("agentSessions")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .first();
    if (session) {
      await ctx.db.patch(session._id, { updatedAt });
    }
  },
});

export const createWithThread = mutation({
  args: {
    agentId: v.id("agents"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Agent not found");

    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: args.title,
    });

    const sessionId = await ctx.db.insert("agentSessions", {
      agentId: args.agentId,
      sessionExternalId: "",
      threadId,
      title: args.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { sessionId, threadId };
  },
});

/**
 * List sessions triggered by a specific automation (auth-gated).
 * Powers the "Runs" section on the automation detail page.
 */
export const listByAutomation = query({
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
      .query("agentSessions")
      .withIndex("by_automation", (q) => q.eq("automationId", automationId))
      .order("desc")
      .take(Math.min(limit, 50));
  },
});

/**
 * Create a session from an automation invocation.
 * Secret-gated (no user auth — called from the cron dispatcher
 * and manual trigger API route).
 *
 * Creates:
 * 1. An `agentSessions` row with `automationId` set
 * 2. A user message in `agentMessages` (the automation instructions)
 *
 * The assistant message is added later by `addAutomationResponse`
 * after the agent completes its run.
 */
export const createFromAutomation = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    automationId: v.id("agentAutomations"),
    automationTrigger: v.string(),
    title: v.string(),
    userMessage: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args.secret);

    const now = Date.now();

    const sessionId = await ctx.db.insert("agentSessions", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      title: args.title,
      automationId: args.automationId,
      automationTrigger: args.automationTrigger,
      automationStatus: "running",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role: "user",
      content: args.userMessage,
      createdAt: now,
    });

    return sessionId;
  },
});

/**
 * Add a message to an automation session.
 * Called both after the agent completes (role=assistant) and when
 * reusing a session for a new run (role=user for the prompt).
 */
export const addAutomationResponse = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    content: v.string(),
    role: v.optional(v.union(v.literal("user"), v.literal("assistant"))),
    title: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args.secret);

    const now = Date.now();
    const role = args.role ?? "assistant";

    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role,
      content: args.content,
      createdAt: now,
    });

    const session = await ctx.db
      .query("agentSessions")
      .withIndex("by_agent_session", (q) =>
        q.eq("agentId", args.agentId).eq("sessionExternalId", args.sessionExternalId),
      )
      .first();

    if (session) {
      await ctx.db.patch(session._id, {
        ...(args.title ? { title: args.title } : {}),
        // Mark completed when the assistant responds (not when user
        // message is added for persistent session reuse).
        ...(role === "assistant" && session.automationId
          ? { automationStatus: "completed" }
          : {}),
        updatedAt: now,
      });
    }
  },
});

// ── Automation run lifecycle mutations ─────────────────────

/**
 * Create a session placeholder BEFORE the sandbox wakes.
 * The UI subscribes via `listByAutomation` and sees the row instantly
 * as "pending". After the sandbox boots and the real OpenCode session
 * is created, `linkPendingSession` patches in the real ID.
 *
 * No messages are created here — the user message is added after the
 * real sessionExternalId is linked, so messages never reference a
 * placeholder ID.
 */
export const createPendingAutomationSession = mutation({
  args: {
    agentId: v.id("agents"),
    automationId: v.id("agentAutomations"),
    automationTrigger: v.string(),
    title: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args.secret);

    const now = Date.now();
    const pendingExternalId = `pending:${args.automationId}:${now}`;

    const sessionId = await ctx.db.insert("agentSessions", {
      agentId: args.agentId,
      sessionExternalId: pendingExternalId,
      title: args.title,
      automationId: args.automationId,
      automationTrigger: args.automationTrigger,
      automationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { sessionId, pendingExternalId };
  },
});

/**
 * Link a pending session to the real OpenCode session ID.
 * Called after the sandbox wakes and creates the real session.
 * Also transitions status from "pending" → "running".
 */
export const linkPendingSession = mutation({
  args: {
    sessionId: v.id("agentSessions"),
    sessionExternalId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args.secret);

    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      sessionExternalId: args.sessionExternalId,
      automationStatus: "running",
    });
  },
});

/**
 * Update the automation lifecycle status on a session.
 * Accepts either the Convex `sessionId` (for pending sessions where
 * we hold the ID from `createPendingAutomationSession`) or
 * `agentId + sessionExternalId` (for persistent session reuse).
 */
export const setAutomationRunStatus = mutation({
  args: {
    sessionId: v.optional(v.id("agentSessions")),
    agentId: v.optional(v.id("agents")),
    sessionExternalId: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args.secret);

    let session;
    if (args.sessionId) {
      session = await ctx.db.get(args.sessionId);
    } else if (args.agentId && args.sessionExternalId) {
      session = await ctx.db
        .query("agentSessions")
        .withIndex("by_agent_session", (q) =>
          q.eq("agentId", args.agentId!).eq("sessionExternalId", args.sessionExternalId!),
        )
        .first();
    }
    if (!session) return;

    // Skip no-op updates to avoid unnecessary subscription pings
    if (session.automationStatus === args.status && args.error === undefined) return;

    await ctx.db.patch(session._id, {
      automationStatus: args.status,
      ...(args.error !== undefined ? { automationError: args.error } : {}),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get a single automation session with its messages.
 * Powers the run detail page at `/automations/[id]/runs/[sessionId]`.
 */
export const getAutomationRun = query({
  args: {
    sessionId: v.id("agentSessions"),
  },
  handler: async (ctx, { sessionId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const session = await ctx.db.get(sessionId);
    if (!session) return null;

    // Parallelize the three independent reads
    const [agent, messages, automation] = await Promise.all([
      ctx.db.get(session.agentId),
      ctx.db
        .query("agentMessages")
        .withIndex("by_session", (q) =>
          q.eq("agentId", session.agentId).eq("sessionExternalId", session.sessionExternalId),
        )
        .order("asc")
        .take(50),
      session.automationId ? ctx.db.get(session.automationId) : null,
    ]);

    if (!agent || agent.userId !== userId) return null;

    return {
      session,
      messages,
      automation: automation
        ? {
            _id: automation._id,
            name: automation.name,
            slug: automation.slug,
            defaultDelivery: automation.defaultDelivery,
          }
        : null,
      agent: {
        _id: agent._id,
        name: agent.name,
        emoji: agent.emoji,
      },
    };
  },
});
