import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserId, requireUserId } from "./authHelpers";
import type { Id } from "./_generated/dataModel";

/**
 * Agent memory files — durable Convex backup of sandbox filesystem memory.
 *
 * The agent writes markdown files to ~/agent/memories/ on the Daytona
 * sandbox. The sync engine (lib/agents/memory-sync.ts) periodically
 * reads those files and upserts them here. The web UI reads from this
 * table when the sandbox is stopped, so memories are always visible.
 */

function requireInternalSecret(secret: string): void {
  const cronSecret = process.env.CRON_INTERNAL_SECRET;
  const chatSecret = process.env.CHAT_STATE_INTERNAL_SECRET;
  const isValid =
    !!secret &&
    ((cronSecret !== undefined && secret === cronSecret) ||
      (chatSecret !== undefined && secret === chatSecret));
  if (!isValid) throw new Error("Forbidden");
}

// ── Auth-gated queries (for web UI) ─────────────────────

/**
 * List all (non-deleted) memory files for an agent.
 * Used by the Settings → Memory page and agent management Knowledge section.
 */
export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) return [];

    const files = await ctx.db
      .query("agentMemoryFiles")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();

    return files
      .filter((f) => f.deletedAt === undefined)
      .map((f) => ({
        id: f._id,
        path: f.path,
        name: f.name,
        type: f.type,
        content: f.content,
        preview: f.content.slice(0, 200),
        syncedAt: f.syncedAt,
      }));
  },
});

// ── Secret-gated queries (for sync engine) ──────────────

/**
 * Get all memory files for an agent with content hashes.
 * Used by the sync engine to diff against the sandbox filesystem.
 */
export const getByAgentInternal = query({
  args: {
    agentId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { agentId, secret }) => {
    requireInternalSecret(secret);
    const internalAgentId = agentId as Id<"agents">;

    const files = await ctx.db
      .query("agentMemoryFiles")
      .withIndex("by_agent", (q) => q.eq("agentId", internalAgentId))
      .collect();

    return files
      .filter((f) => f.deletedAt === undefined)
      .map((f) => ({
        id: f._id,
        path: f.path,
        name: f.name,
        contentHash: f.contentHash,
        syncedAt: f.syncedAt,
      }));
  },
});

// ── Secret-gated mutations (for sync engine) ────────────

/**
 * Batch upsert memory files from the sync engine.
 * Compares by contentHash — skips unchanged files.
 * Single mutation = one Convex round-trip for all files.
 */
export const upsertBatch = mutation({
  args: {
    agentId: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        name: v.string(),
        type: v.string(),
        content: v.string(),
        contentHash: v.string(),
      }),
    ),
    secret: v.string(),
  },
  handler: async (ctx, { agentId, files, secret }) => {
    requireInternalSecret(secret);
    const internalAgentId = agentId as Id<"agents">;

    let upserted = 0;
    let unchanged = 0;

    for (const file of files) {
      const existing = await ctx.db
        .query("agentMemoryFiles")
        .withIndex("by_agent_and_path", (q) =>
          q.eq("agentId", internalAgentId).eq("path", file.path),
        )
        .first();

      if (existing) {
        if (existing.contentHash === file.contentHash) {
          unchanged++;
          continue;
        }
        await ctx.db.patch(existing._id, {
          name: file.name,
          type: file.type,
          content: file.content,
          contentHash: file.contentHash,
          syncedAt: Date.now(),
          deletedAt: undefined,
        });
        upserted++;
      } else {
        await ctx.db.insert("agentMemoryFiles", {
          agentId: internalAgentId,
          path: file.path,
          name: file.name,
          type: file.type,
          content: file.content,
          contentHash: file.contentHash,
          syncedAt: Date.now(),
        });
        upserted++;
      }
    }

    return { upserted, unchanged };
  },
});

/**
 * Soft-delete memory files that no longer exist on the sandbox.
 */
export const markDeleted = mutation({
  args: {
    agentId: v.string(),
    paths: v.array(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, { agentId, paths, secret }) => {
    requireInternalSecret(secret);
    const internalAgentId = agentId as Id<"agents">;

    let deleted = 0;
    for (const path of paths) {
      const existing = await ctx.db
        .query("agentMemoryFiles")
        .withIndex("by_agent_and_path", (q) =>
          q.eq("agentId", internalAgentId).eq("path", path),
        )
        .first();

      if (existing && existing.deletedAt === undefined) {
        await ctx.db.patch(existing._id, { deletedAt: Date.now() });
        deleted++;
      }
    }

    return { deleted };
  },
});

// ── Auth-gated mutation (for web UI edits) ──────────────

/**
 * Upsert a single memory file from the web UI.
 * Called alongside the sandbox filesystem write (dual-write pattern).
 */
export const upsertFromUI = mutation({
  args: {
    agentId: v.id("agents"),
    path: v.string(),
    name: v.string(),
    type: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { agentId, path, name, type, content }) => {
    const userId = await requireUserId(ctx);

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.userId !== userId) throw new Error("Forbidden");

    // Compute hash server-side
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const existing = await ctx.db
      .query("agentMemoryFiles")
      .withIndex("by_agent_and_path", (q) =>
        q.eq("agentId", agentId).eq("path", path),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        type,
        content,
        contentHash,
        syncedAt: Date.now(),
        deletedAt: undefined,
      });
    } else {
      await ctx.db.insert("agentMemoryFiles", {
        agentId,
        path,
        name,
        type,
        content,
        contentHash,
        syncedAt: Date.now(),
      });
    }
  },
});
