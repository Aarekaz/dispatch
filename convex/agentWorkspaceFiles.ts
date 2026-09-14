import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";

/**
 * Workspace file tree mirror — shallow structural cache of the Daytona
 * sandbox filesystem. Rows are keyed by (agentId, parentPath). One row
 * per file or directory inside that parent.
 *
 * Purpose: let the Files UI show the tree when the sandbox is stopped,
 * without silently waking it. File *contents* are NOT cached here; the
 * viewer pane still requires a running sandbox.
 *
 * The mirror is populated opportunistically — every successful live
 * listing served by `/api/agents/[id]/files` calls `upsertListing`.
 */

export const listByAgentAndParent = query({
  args: {
    agentId: v.id("agents"),
    parentPath: v.string(),
  },
  handler: async (ctx, { agentId, parentPath }) => {
    const userId = await getUserId(ctx);
    if (!userId) return { files: [], lastSyncedAt: null };

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) {
      return { files: [], lastSyncedAt: null };
    }

    const rows = await ctx.db
      .query("agentWorkspaceFiles")
      .withIndex("by_agent_and_parent", (q) =>
        q.eq("agentId", agentId).eq("parentPath", parentPath),
      )
      .collect();

    if (rows.length === 0) return { files: [], lastSyncedAt: null };

    const files = rows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      type: r.type,
      size: r.size,
    }));

    // Each row shares the same syncedAt (written together); grab the max
    // defensively in case stragglers from prior writes are still around.
    const lastSyncedAt = rows.reduce(
      (acc, r) => (r.syncedAt > acc ? r.syncedAt : acc),
      0,
    );

    return { files, lastSyncedAt };
  },
});

/**
 * Replace the cached listing for a single (agentId, parentPath). Called
 * by the files route after a successful live list against the sandbox.
 *
 * Transactional: deletes stale rows and inserts fresh ones in one mutation
 * so the cache never shows a partial view.
 */
export const upsertListing = mutation({
  args: {
    agentId: v.id("agents"),
    parentPath: v.string(),
    files: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        path: v.string(),
        type: v.union(v.literal("file"), v.literal("directory")),
        size: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { agentId, parentPath, files }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) throw new Error("Forbidden");

    const existing = await ctx.db
      .query("agentWorkspaceFiles")
      .withIndex("by_agent_and_parent", (q) =>
        q.eq("agentId", agentId).eq("parentPath", parentPath),
      )
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const syncedAt = Date.now();
    for (const f of files) {
      await ctx.db.insert("agentWorkspaceFiles", {
        agentId,
        parentPath,
        id: f.id,
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
        syncedAt,
      });
    }

    return { syncedAt };
  },
});
