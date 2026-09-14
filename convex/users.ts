import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./betterAuth/auth";
import { requireUserId } from "./authHelpers";

/**
 * Get the current authenticated user's profile + credits + personalization.
 *
 * Identity comes from Better Auth (the `users` table is gone — Better Auth
 * lives in its own component). Personalization fields and credits balance
 * live on the `userProfiles` side table keyed by Better Auth user id.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return {
      id: user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      image: user.image ?? null,
      plan: profile?.subscriptionTier ?? "Pro",
      credits: {
        used: 0,
        total: profile?.creditsBalance ?? 5000,
      },
      nickname: profile?.nickname ?? "",
      company: profile?.company ?? "",
      industry: profile?.industry ?? "",
      background: profile?.background ?? "",
      customInstructions: profile?.customInstructions ?? "",
      timezone: profile?.timezone ?? "",
      soundEnabled: profile?.soundEnabled ?? false,
    };
  },
});

/**
 * Update user profile and personalization fields.
 * Auth-gated — only the authenticated user can update their own profile.
 *
 * `name` is owned by Better Auth (the auth component's user record), so
 * this mutation only patches the personalization fields on `userProfiles`.
 * Updating display name is a separate concern handled via Better Auth.
 */
export const update = mutation({
  args: {
    nickname: v.optional(v.string()),
    company: v.optional(v.string()),
    industry: v.optional(v.string()),
    background: v.optional(v.string()),
    customInstructions: v.optional(v.string()),
    timezone: v.optional(v.string()),
    soundEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, fields) => {
    const userId = await requireUserId(ctx);

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 0) return;

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("userProfiles", {
        userId,
        creditsBalance: 5000,
        subscriptionTier: "Pro",
        ...updates,
      });
    }
  },
});
