import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUserId } from "./authHelpers";

/**
 * Shared secret check for webhook-callable mutations. Same env var
 * as `convex/chatState.ts` and `convex/integrations.ts:findByBinding`.
 */
function requireWebhookSecret(secret: string): void {
  if (!secret || secret !== process.env.CHAT_STATE_INTERNAL_SECRET) {
    throw new Error("Forbidden — invalid webhook secret");
  }
}

/**
 * Persist a user + assistant message pair to Convex.
 *
 * Called from the API route's onFinish after streaming completes.
 * Fire-and-forget — the user already saw the response.
 * This is a write-behind cache so messages survive sandbox restarts.
 */
export const persistMessages = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    userMessage: v.string(),
    assistantMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.userId !== userId) throw new Error("Not found");

    const now = Date.now();

    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role: "user",
      content: args.userMessage,
      createdAt: now,
    });

    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role: "assistant",
      content: args.assistantMessage,
      createdAt: now + 1,
    });
  },
});

/**
 * Webhook-callable variant of `persistMessages`. No auth check —
 * the Vercel webhook handler that invokes this has no Convex Auth
 * session, so authorization is enforced by the shared secret.
 *
 * Used by `lib/chat/handlers/message.ts` after a Chat SDK platform
 * handler completes a streamed reply, mirroring the same persistence
 * the web sandbox route does in `app/api/agents/[id]/chat/route.ts`.
 */
export const persistMessagesFromWebhook = mutation({
  args: {
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    userMessage: v.string(),
    assistantMessage: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWebhookSecret(args.secret);

    const now = Date.now();
    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role: "user",
      content: args.userMessage,
      createdAt: now,
    });
    await ctx.db.insert("agentMessages", {
      agentId: args.agentId,
      sessionExternalId: args.sessionExternalId,
      role: "assistant",
      content: args.assistantMessage,
      createdAt: now + 1, // ensure ordering
    });
  },
});
