import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";

/**
 * Convex backing for Vercel Chat SDK's `StateAdapter` interface.
 *
 * Each exported function maps 1:1 to a method on the StateAdapter
 * interface defined at `node_modules/chat/dist/index.d.ts:845`.
 * The TypeScript adapter at `lib/chat/state/convex-state-adapter.ts`
 * proxies each method into one of these via `fetchMutation` /
 * `fetchQuery`, passing the `CHAT_STATE_INTERNAL_SECRET` so requests
 * cannot be forged from outside the Vercel runtime.
 *
 * **Why these are `mutation`/`query` instead of `internalMutation`/
 * `internalQuery`.** Convex's `fetchMutation`/`fetchQuery` from
 * `convex/nextjs` only accept *public* function references —
 * `internal*` functions can only be called from inside Convex
 * (via `ctx.runMutation`, etc.) or via an HTTP action. The Vercel
 * webhook handler is OUTSIDE Convex, so it needs public functions.
 * The secret arg is the access control: `requireSecret()` rejects
 * any caller that doesn't supply the matching env-loaded secret,
 * making these functions "public on paper, internal in practice."
 * This is the same pattern used by `convex/runs.ts:logInternal`.
 *
 * `sweepExpired` is the one exception — it's called by `crons.ts`
 * (which is inside Convex) so it stays `internalMutation`.
 *
 * **Convex OCC is the safety net.** Convex serializes concurrent
 * mutations on the same row via optimistic concurrency control, so
 * `acquireLock` and `setIfNotExists` are atomic compare-and-set
 * operations without needing Lua scripts or pessimistic row locks.
 * Two concurrent acquires for the same key will see the same read
 * set; one commits, the other retries automatically.
 *
 * **TTL is lazy.** Reads always check `expiresAt > now` before
 * returning a row, and the `sweepExpired` cron (registered in
 * convex/crons.ts) runs every 10 minutes to garbage-collect rows
 * that have already passed their expiry but haven't been read since.
 */

// ── Auth helper ──────────────────────────────────────────────

function requireSecret(secret: string): void {
  if (!secret || secret !== process.env.CHAT_STATE_INTERNAL_SECRET) {
    throw new Error("Forbidden — invalid chat-state secret");
  }
}

// ── Locks ────────────────────────────────────────────────────

/**
 * Acquire a lock on a key. Returns the lock metadata if successful,
 * `null` if a non-expired lock is already held.
 *
 * The TypeScript adapter generates the random `token`. Convex
 * doesn't generate randomness inside mutations because we want the
 * adapter to own ownership semantics.
 */
export const acquireLock = mutation({
  args: {
    key: v.string(),
    token: v.string(),
    ttlMs: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    const existing = await ctx.db
      .query("chatLocks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (existing && existing.expiresAt > now) {
      return null;
    }

    const expiresAt = now + args.ttlMs;
    if (existing) {
      // Stale lock — replace in place rather than insert+delete.
      await ctx.db.patch(existing._id, {
        token: args.token,
        expiresAt,
      });
    } else {
      await ctx.db.insert("chatLocks", {
        key: args.key,
        token: args.token,
        expiresAt,
      });
    }

    return { key: args.key, token: args.token, expiresAt };
  },
});

/**
 * Release a lock — only if the token matches the holder.
 * No-op if no row, or if a different holder owns the lock now.
 */
export const releaseLock = mutation({
  args: {
    key: v.string(),
    token: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatLocks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!existing) return null;
    if (existing.token !== args.token) return null;
    await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Extend a lock's TTL — only if the token matches the holder.
 * Returns true on success, false if the holder no longer owns it.
 */
export const extendLock = mutation({
  args: {
    key: v.string(),
    token: v.string(),
    ttlMs: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatLocks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!existing || existing.token !== args.token) return false;
    await ctx.db.patch(existing._id, {
      expiresAt: Date.now() + args.ttlMs,
    });
    return true;
  },
});

/**
 * Force-release a lock regardless of token. Used by Chat SDK's
 * `onLockConflict: "force"` mode to interrupt long-running handlers.
 */
export const forceReleaseLock = mutation({
  args: {
    key: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatLocks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

// ── Key-Value with TTL ───────────────────────────────────────

export const get = query({
  args: {
    key: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    // Capture once — Date.now() in queries breaks Convex's deterministic
    // caching. Ideally the caller would pass `now` as an argument, but
    // this is a Chat SDK adapter function with a fixed interface.
    // Single capture at least ensures consistency within one handler run.
    const now = Date.now();
    const row = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!row) return null;
    if (row.expiresAt !== undefined && row.expiresAt <= now) {
      return null;
    }
    return row.value;
  },
});

export const set = mutation({
  args: {
    key: v.string(),
    value: v.any(),
    ttlMs: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    const expiresAt = args.ttlMs ? now + args.ttlMs : undefined;
    const existing = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, expiresAt });
    } else {
      await ctx.db.insert("chatKv", {
        key: args.key,
        value: args.value,
        expiresAt,
      });
    }
    return null;
  },
});

export const deleteKey = mutation({
  args: {
    key: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/**
 * Atomic set-if-not-exists. Returns true if the value was set,
 * false if the key already existed (and is not expired).
 *
 * This is the canary for Convex's OCC mapping — if two concurrent
 * webhooks call this with the same key, exactly one will commit and
 * return true. The other retries internally and sees the row from
 * the winning transaction, returning false.
 */
export const setIfNotExists = mutation({
  args: {
    key: v.string(),
    value: v.any(),
    ttlMs: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    const existing = await ctx.db
      .query("chatKv")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (
      existing &&
      (existing.expiresAt === undefined || existing.expiresAt > now)
    ) {
      return false;
    }
    if (existing) {
      // Replace expired row in place.
      await ctx.db.patch(existing._id, {
        value: args.value,
        expiresAt: args.ttlMs ? now + args.ttlMs : undefined,
      });
    } else {
      await ctx.db.insert("chatKv", {
        key: args.key,
        value: args.value,
        expiresAt: args.ttlMs ? now + args.ttlMs : undefined,
      });
    }
    return true;
  },
});

// ── Append-only lists ────────────────────────────────────────

export const getList = query({
  args: {
    key: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    // Bounded read — chatLists shouldn't grow large in normal use,
    // but defensive .take() prevents pathological scans if a caller
    // forgets to set maxLength.
    const rows = await ctx.db
      .query("chatLists")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .order("asc")
      .take(1000);
    return rows
      .filter((r) => r.expiresAt === undefined || r.expiresAt > now)
      .map((r) => r.value);
  },
});

export const appendToList = mutation({
  args: {
    key: v.string(),
    value: v.any(),
    maxLength: v.optional(v.number()),
    ttlMs: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    const expiresAt = args.ttlMs ? now + args.ttlMs : undefined;

    await ctx.db.insert("chatLists", {
      key: args.key,
      value: args.value,
      expiresAt,
    });

    // Trim oldest entries beyond maxLength (keeping newest), per the
    // StateAdapter doc.
    if (args.maxLength !== undefined) {
      const all = await ctx.db
        .query("chatLists")
        .withIndex("by_key", (q) => q.eq("key", args.key))
        .order("asc")
        .take(args.maxLength * 3);
      const overflow = all.length - args.maxLength;
      if (overflow > 0) {
        for (let i = 0; i < overflow; i++) {
          await ctx.db.delete(all[i]._id);
        }
      }
    }
    return null;
  },
});

// ── Per-thread queue ─────────────────────────────────────────

export const enqueue = mutation({
  args: {
    threadId: v.string(),
    enqueuedAt: v.number(),
    expiresAt: v.number(),
    messageJson: v.any(),
    maxSize: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);

    await ctx.db.insert("chatQueue", {
      threadId: args.threadId,
      enqueuedAt: args.enqueuedAt,
      expiresAt: args.expiresAt,
      messageJson: args.messageJson,
    });

    // Trim oldest beyond maxSize. Use a generous upper bound on the
    // bounded read — at the configured maxQueueSize: 10 in lib/chat/bot.ts,
    // taking 30 leaves plenty of headroom for trim accuracy without
    // ever scanning the full table.
    const all = await ctx.db
      .query("chatQueue")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(args.maxSize * 3 + 10);

    if (all.length > args.maxSize) {
      const overflow = all.length - args.maxSize;
      for (let i = 0; i < overflow; i++) {
        await ctx.db.delete(all[i]._id);
      }
    }
    return Math.min(all.length, args.maxSize);
  },
});

/**
 * Pop the oldest non-expired message from a thread's queue.
 * Returns the QueueEntry shape Chat SDK expects, or null if empty.
 *
 * Expired rows encountered during the search are deleted opportunistically
 * so callers don't pay for them on subsequent dequeues.
 */
export const dequeue = mutation({
  args: {
    threadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();

    const candidates = await ctx.db
      .query("chatQueue")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .take(50);

    for (const candidate of candidates) {
      if (candidate.expiresAt <= now) {
        await ctx.db.delete(candidate._id);
        continue;
      }
      const result = {
        enqueuedAt: candidate.enqueuedAt,
        expiresAt: candidate.expiresAt,
        message: candidate.messageJson,
      };
      await ctx.db.delete(candidate._id);
      return result;
    }
    return null;
  },
});

export const queueDepth = query({
  args: {
    threadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    // Bounded — at maxQueueSize: 10 we expect at most ~10 rows.
    // 50 is a safe upper bound that protects against pathological queues.
    const rows = await ctx.db
      .query("chatQueue")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .take(50);
    return rows.filter((r) => r.expiresAt > now).length;
  },
});

// ── Subscriptions ────────────────────────────────────────────

export const subscribe = mutation({
  args: {
    threadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatSubscriptions")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (existing) return null;
    await ctx.db.insert("chatSubscriptions", { threadId: args.threadId });
    return null;
  },
});

export const unsubscribe = mutation({
  args: {
    threadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatSubscriptions")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const isSubscribed = query({
  args: {
    threadId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query("chatSubscriptions")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    return existing !== null;
  },
});

// ── Cron-driven cleanup ──────────────────────────────────────

/**
 * Garbage-collect rows that have passed their `expiresAt` time.
 *
 * Lazy TTL on reads handles the read path correctly, but rows need to
 * be physically deleted at some point so the tables don't accumulate
 * stale data. Called by `internal.crons.sweep` every 10 minutes.
 *
 * Bounded per-table batch size: 500. At Phase 1a scale (a handful of
 * customer messages per minute) this is comfortably more than what
 * accumulates between sweeps. Each table has a `by_expiresAt` index
 * so the query only scans expired rows, not the full table. If tables
 * grow beyond the batch size, schedule a recursive continuation via
 * `ctx.scheduler.runAfter`.
 */
export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const BATCH = 500;
    let deleted = 0;

    // CRITICAL: the `expiresAt !== undefined` guard inside each loop
    // is NOT redundant with the index filter. In Convex, `undefined`
    // values sort before numbers in indexes, so
    // `.lte("expiresAt", now)` MATCHES rows where expiresAt is
    // undefined (because undefined < now in index order). Without
    // the guard, this sweep deletes Slack installations, thread
    // subscriptions, and other permanent KV entries that have no
    // expiry. This bug was introduced and caught on 2026-04-09.

    const expiredLocks = await ctx.db
      .query("chatLocks")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(BATCH);
    for (const row of expiredLocks) {
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    const expiredKv = await ctx.db
      .query("chatKv")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(BATCH);
    for (const row of expiredKv) {
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    const expiredLists = await ctx.db
      .query("chatLists")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(BATCH);
    for (const row of expiredLists) {
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    const expiredQueue = await ctx.db
      .query("chatQueue")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(BATCH);
    for (const row of expiredQueue) {
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    return { deleted };
  },
});
