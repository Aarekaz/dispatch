/**
 * Per-agent Composio Tool Router session helper.
 *
 * The ONE place that calls `composio.create(userId, ...)` on our side.
 * Returns the MCP transport config (url + headers) so the runtime layer
 * can inject it into the OpenCode config as a remote MCP server.
 *
 * ## Per-agent identity
 *
 * The Composio `user_id` we pass is **not** the raw Convex user id.
 * It's a composite: `${convexUserId}:${agentId}`. This gives every
 * agent its own isolated pool of Composio connections — Sales Bot's
 * Gmail, Support Bot's Gmail, and so on are entirely separate.
 * Enabling Gmail on a new agent will never silently grant it access
 * to another agent's inbox.
 *
 * If you ever need to change the identity format (add a tenant
 * prefix, migrate to a hashed id, etc.), `composioIdentityFor()` is
 * the only edit site. Every call site in the codebase routes through
 * it.
 *
 * ## Caching
 *
 * Composio session creation is an HTTP round trip (200–500ms). Without
 * a cache we'd pay that on every warm chat turn. Sessions are
 * immutable once created, so it's safe to cache them in-process.
 * Cache key is `${identity}|${sortedToolkits.join(",")}`, TTL 5 min.
 *
 * ## Soft-fail
 *
 * If `toolkits` is empty, or if the Composio API call throws for any
 * reason, this returns `null`. Callers treat that as "no MCP block
 * to inject" — the agent still runs with its native tools, it just
 * doesn't have Composio tools for this turn. A Composio outage must
 * never break local-only chat.
 */
import { CHAT_SDK_CHANNEL_SLUGS } from "./chat-channels";
import { getComposio } from "./client";

export type ComposioMcpConfig = {
  url: string;
  headers: Record<string, string>;
};

/**
 * Composite Composio identity for (user, agent).
 *
 * Exported so the toolkits catalog / connection-status helper and the
 * `/api/composio/toolkits` route can read status against the *same*
 * identity the runtime writes to. Never inline the format elsewhere.
 */
export function composioIdentityFor(
  userId: string,
  agentId: string,
): string {
  return `${userId}:${agentId}`;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { value: ComposioMcpConfig; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(identity: string, toolkits: string[]): string {
  return `${identity}|${[...toolkits].sort().join(",")}`;
}

export async function getComposioMcpConfig(params: {
  userId: string; // Convex Id<"users">, server-derived
  agentId: string; // Convex Id<"agents">, server-derived
  toolkits: string[]; // from agent.composioToolkits
}): Promise<ComposioMcpConfig | null> {
  const { userId, agentId, toolkits } = params;

  // Defensive strip of Chat-SDK-owned channels. Chat SDK delivers
  // replies on these platforms via `thread.post()`, so exposing the
  // Composio slack_send_message / telegram_send_message tools to the
  // LLM would risk double posts. See ./chat-channels.ts.
  //
  // This runs even for agents whose DB record still lists these slugs
  // (pre-catalog-filter data) so the model NEVER sees them regardless
  // of how they got into `composioToolkits`.
  const effectiveToolkits = (toolkits ?? []).filter(
    (slug) => !CHAT_SDK_CHANNEL_SLUGS.has(slug),
  );

  // No toolkits → no MCP block. Avoids a pointless API call and keeps
  // the OpenCode config unchanged for agents that don't use Composio.
  if (effectiveToolkits.length === 0) {
    return null;
  }

  const identity = composioIdentityFor(userId, agentId);
  const key = cacheKey(identity, effectiveToolkits);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  try {
    const composio = getComposio();
    // `composio.create()` returns a ToolRouter Session. We only need
    // the MCP transport config. `manageConnections: true` enables the
    // in-chat auth meta-tool (`COMPOSIO_MANAGE_CONNECTIONS`) so users
    // can OAuth toolkits from the conversation itself.
    const session = await composio.create(identity, {
      toolkits: effectiveToolkits,
      manageConnections: true,
    });

    const value: ComposioMcpConfig = {
      url: session.mcp.url,
      headers: session.mcp.headers ?? {},
    };
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (err) {
    // Soft-fail: log and return null. An outage in Composio must not
    // break local-only chat. The next turn will retry; caller sees
    // "no Composio tools this turn" rather than an HTTP 500.
    console.error("[composio/session] Failed to create session:", err);
    return null;
  }
}

/**
 * Clear the in-process session cache for one (user, agent, toolkits)
 * triple. Call this when the toolkit list changes — otherwise the
 * next few minutes of chat turns would serve stale MCP URLs.
 *
 * Note: this only clears the cache entry for the *exact* toolkit list.
 * Since toolkit changes mean the next call will use a different key
 * anyway, this is mostly a memory hygiene helper. Included for
 * completeness and for future test hooks.
 */
export function invalidateComposioSessionCache(params: {
  userId: string;
  agentId: string;
  toolkits?: string[];
}): void {
  const identity = composioIdentityFor(params.userId, params.agentId);
  if (params.toolkits) {
    cache.delete(cacheKey(identity, params.toolkits));
    return;
  }
  // No toolkits given — drop every entry for this identity.
  const prefix = `${identity}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
