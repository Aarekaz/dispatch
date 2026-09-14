import { query, type QueryCtx } from "./_generated/server";
import { authComponent } from "./betterAuth/auth";

export async function getUserId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function requireUserId(ctx: QueryCtx): Promise<string> {
  const userId = await getUserId(ctx);
  if (!userId) throw new Error("Unauthenticated");
  return userId;
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
});
