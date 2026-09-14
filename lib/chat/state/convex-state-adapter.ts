import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { Lock, Message, QueueEntry, StateAdapter } from "chat";

import { api } from "@/convex/_generated/api";
import { getSecret } from "@/lib/chat/secrets";

/**
 * Convex-backed implementation of Chat SDK's `StateAdapter` interface.
 *
 * Each method proxies to a corresponding `internalMutation` /
 * `internalQuery` in `convex/chatState.ts`, passing
 * `CHAT_STATE_INTERNAL_SECRET` so requests cannot be forged from
 * outside the Vercel runtime.
 *
 * This adapter is the seam between Chat SDK (which expects an
 * in-process synchronous-ish state interface) and Convex (which is
 * an HTTP-backed transactional database). The two key concerns are:
 *
 * 1. **Latency.** Each Convex call is a `fetchMutation`/`fetchQuery`
 *    round-trip from Vercel to Convex (~40-80ms). Chat SDK makes
 *    ~6-8 state calls per webhook on the hot path (dedupe, lock,
 *    isSubscribed, get state, etc.), so a tiny in-memory micro-cache
 *    on `get` and `isSubscribed` cuts the cumulative latency by
 *    ~half. The cache TTL is intentionally short (5s) so consistency
 *    drift never crosses webhook boundaries.
 *
 * 2. **Message rehydration.** Chat SDK's `Chat` class has a private
 *    `rehydrateMessage` method that reconstructs `Message` instances
 *    from plain JSON after they round-trip through the state adapter
 *    (see `node_modules/chat/dist/index.d.ts:2706`). We strip class
 *    invariants on enqueue via `JSON.parse(JSON.stringify(...))` and
 *    return plain objects on dequeue — Chat SDK handles the rest.
 */
export class ConvexStateAdapter implements StateAdapter {
  // ── Hot-path micro-cache ─────────────────────────────────
  // Keys: "get:<key>" and "sub:<threadId>". Cleared on writes.
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 5_000;

  private cacheGet(cacheKey: string): unknown | typeof MISS {
    const entry = this.cache.get(cacheKey);
    if (!entry) return MISS;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return MISS;
    }
    return entry.value;
  }

  private cacheSet(cacheKey: string, value: unknown): void {
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + ConvexStateAdapter.CACHE_TTL_MS,
    });
  }

  private cacheInvalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }

  // ── Lifecycle (no-ops for HTTP-backed Convex) ────────────

  async connect(): Promise<void> {
    // Convex uses HTTP — no persistent connection to open.
  }

  async disconnect(): Promise<void> {
    // No-op; clear the in-memory cache so a recycled instance
    // doesn't serve stale reads.
    this.cache.clear();
  }

  // ── Locks ────────────────────────────────────────────────

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const token = generateToken();
    const result = await fetchMutation(api.chatState.acquireLock, {
      key: threadId,
      token,
      ttlMs,
      secret: getSecret(),
    });
    if (!result) return null;
    // Convex stores the lock under `key`; Chat SDK's `Lock` interface
    // uses `threadId` for the same value. Field rename only.
    return {
      threadId: result.key,
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }

  async releaseLock(lock: Lock): Promise<void> {
    await fetchMutation(api.chatState.releaseLock, {
      key: lock.threadId,
      token: lock.token,
      secret: getSecret(),
    });
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    return await fetchMutation(api.chatState.extendLock, {
      key: lock.threadId,
      token: lock.token,
      ttlMs,
      secret: getSecret(),
    });
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    await fetchMutation(api.chatState.forceReleaseLock, {
      key: threadId,
      secret: getSecret(),
    });
  }

  // ── Key-value with TTL ───────────────────────────────────

  async get<T = unknown>(key: string): Promise<T | null> {
    const cacheKey = `get:${key}`;
    const cached = this.cacheGet(cacheKey);
    if (cached !== MISS) return cached as T | null;

    const value = await fetchQuery(api.chatState.get, {
      key,
      secret: getSecret(),
    });
    this.cacheSet(cacheKey, value);
    return value as T | null;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    await fetchMutation(api.chatState.set, {
      key,
      value,
      ttlMs,
      secret: getSecret(),
    });
    // Update the cache with the freshly-written value rather than
    // invalidating, so the next read in the same webhook is also fast.
    this.cacheSet(`get:${key}`, value);
  }

  async delete(key: string): Promise<void> {
    await fetchMutation(api.chatState.deleteKey, {
      key,
      secret: getSecret(),
    });
    this.cacheInvalidate(`get:${key}`);
  }

  async setIfNotExists(
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<boolean> {
    const wasSet = await fetchMutation(api.chatState.setIfNotExists, {
      key,
      value,
      ttlMs,
      secret: getSecret(),
    });
    if (wasSet) {
      this.cacheSet(`get:${key}`, value);
    }
    return wasSet;
  }

  // ── Lists ────────────────────────────────────────────────

  async getList<T = unknown>(key: string): Promise<T[]> {
    return (await fetchQuery(api.chatState.getList, {
      key,
      secret: getSecret(),
    })) as T[];
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    await fetchMutation(api.chatState.appendToList, {
      key,
      value,
      maxLength: options?.maxLength,
      ttlMs: options?.ttlMs,
      secret: getSecret(),
    });
  }

  // ── Per-thread queue ─────────────────────────────────────

  async enqueue(
    threadId: string,
    entry: QueueEntry,
    maxSize: number,
  ): Promise<number> {
    // Strip class instance methods + canonicalize Date fields by
    // round-tripping through JSON. Chat SDK's `rehydrateMessage`
    // restores invariants on the consumer side after `dequeue`.
    const messageJson = JSON.parse(JSON.stringify(entry.message));
    return await fetchMutation(api.chatState.enqueue, {
      threadId,
      enqueuedAt: entry.enqueuedAt,
      expiresAt: entry.expiresAt,
      messageJson,
      maxSize,
      secret: getSecret(),
    });
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const result = await fetchMutation(api.chatState.dequeue, {
      threadId,
      secret: getSecret(),
    });
    if (!result) return null;
    return {
      enqueuedAt: result.enqueuedAt,
      expiresAt: result.expiresAt,
      // Plain JSON object — Chat SDK rehydrates into a Message instance.
      message: result.message as Message,
    };
  }

  async queueDepth(threadId: string): Promise<number> {
    return await fetchQuery(api.chatState.queueDepth, {
      threadId,
      secret: getSecret(),
    });
  }

  // ── Subscriptions ────────────────────────────────────────

  async subscribe(threadId: string): Promise<void> {
    await fetchMutation(api.chatState.subscribe, {
      threadId,
      secret: getSecret(),
    });
    this.cacheSet(`sub:${threadId}`, true);
  }

  async unsubscribe(threadId: string): Promise<void> {
    await fetchMutation(api.chatState.unsubscribe, {
      threadId,
      secret: getSecret(),
    });
    this.cacheSet(`sub:${threadId}`, false);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    const cacheKey = `sub:${threadId}`;
    const cached = this.cacheGet(cacheKey);
    if (cached !== MISS) return cached as boolean;

    const value = await fetchQuery(api.chatState.isSubscribed, {
      threadId,
      secret: getSecret(),
    });
    this.cacheSet(cacheKey, value);
    return value;
  }
}

/**
 * Factory matching Chat SDK's `createRedisState()` / `createPostgresState()`
 * convention. Use this in `lib/chat/bot.ts`:
 *
 *   ```ts
 *   const bot = new Chat({
 *     state: createConvexState(),
 *     // ...
 *   });
 *   ```
 */
export function createConvexState(): StateAdapter {
  return new ConvexStateAdapter();
}

// ── Internals ────────────────────────────────────────────────

/** Sentinel for "cache miss" so we can distinguish from `null` (a valid stored value). */
const MISS = Symbol("cache-miss");


/**
 * Generate a random lock token. Uses Web Crypto's `randomUUID` which
 * is available in Node 19+ as a global and in all modern Vercel runtimes.
 */
function generateToken(): string {
  return crypto.randomUUID();
}
