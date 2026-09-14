/**
 * Per-request context propagated via Node's `AsyncLocalStorage`.
 *
 * One `correlationId` (cid) is minted at route ingress and threaded
 * through every downstream call — perf logs, error reports, fetch
 * subprocesses — without having to plumb it through every function
 * signature. Greppable across logs to reconstruct the full timeline
 * of one request even when concurrent requests interleave.
 *
 * Usage:
 *   import { withRequestContext, getCid } from "@/lib/request-context";
 *
 *   export async function POST(req) {
 *     return withRequestContext({ agentId }, async () => {
 *       // any perfLog / perfTimer call inside auto-includes cid
 *       const cid = getCid();
 *       // ... do work
 *     });
 *   }
 *
 * Outside a `withRequestContext` block, `getCid()` returns undefined
 * and `perfLog` falls back to its current behavior — so this is safe
 * to roll out incrementally.
 *
 * Why ALS over a header-passing helper: cold-start crosses many
 * boundaries (Daytona SDK, OpenCode SDK, Composio SDK, custom fetch
 * wrappers). Plumbing a `cid` arg through each one would touch dozens
 * of signatures. ALS sets it once and every descendant async call
 * sees it without code changes.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  /** Short, greppable correlation ID. 8 chars from `crypto.randomUUID()`. */
  cid: string;
  /** Optional agent scope — auto-included in logs when set. */
  agentId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Mint a fresh correlation ID. 8 hex chars from a v4 UUID — short
 * enough to read at a glance, long enough to be unique within a
 * single deploy's log retention window.
 */
export function mintCid(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Run `fn` with the given context bound to the async chain. Any
 * `getCid()` / `getRequestContext()` call inside (including across
 * awaits and `Promise.all`) sees the same context.
 *
 * If `ctx.cid` is omitted, mints a fresh one. Pass an explicit cid
 * when continuing an upstream trace (e.g. honoring an inbound
 * `x-correlation-id` header from the client).
 */
export function withRequestContext<T>(
  ctx: Partial<RequestContext> & { agentId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const cid = ctx.cid ?? mintCid();
  return storage.run({ cid, agentId: ctx.agentId }, fn);
}

/** Current correlation ID, or `undefined` outside a request context. */
export function getCid(): string | undefined {
  return storage.getStore()?.cid;
}

/** Full request context, or `undefined` outside a request context. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
