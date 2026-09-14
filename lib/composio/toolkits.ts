/**
 * Catalog and connection-status helpers for the Composio settings UI.
 *
 * These wrap the Composio SDK's toolkit and connected-account APIs
 * with two conveniences:
 *
 *   1. `listAvailableToolkits()` — aggressively cached catalog of
 *      every toolkit Composio supports, trimmed to the fields the
 *      UI actually renders (slug, name, logo, short description,
 *      category). The catalog changes on the scale of Composio
 *      shipping new integrations, so a 10-minute in-process cache
 *      is fine.
 *
 *   2. `getConnectionStatus({ userId, agentId, toolkits })` — queries
 *      the connected-accounts API scoped to the same per-agent
 *      Composio identity the runtime uses (`composioIdentityFor()`),
 *      so the UI's ✅/⚠ pills agree with what the agent sees at
 *      runtime. Returns one entry per requested toolkit, including
 *      a human-readable `accountLabel` when available — that label
 *      (`sales@acme.com`, `acme-workspace.slack.com`, etc.) is the
 *      direct UX proof of per-agent isolation: two agents wired to
 *      the same toolkit will show different labels.
 */
import { CHAT_SDK_CHANNEL_SLUGS } from "./chat-channels";
import { getComposio } from "./client";
import { composioIdentityFor } from "./session";

export type ToolkitListItem = {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
};

type ToolkitCacheEntry = {
  value: ToolkitListItem[];
  expiresAt: number;
};

const TOOLKIT_CACHE_TTL_MS = 10 * 60 * 1000;
let toolkitCache: ToolkitCacheEntry | null = null;

/**
 * Return the full Composio toolkit catalog, trimmed to the fields
 * the settings UI renders. In-process cache with a 10-minute TTL.
 *
 * Soft-fails to an empty array on any SDK error so the settings page
 * doesn't crash if Composio is down — the user sees an empty catalog
 * and a graceful message upstream.
 */
export async function listAvailableToolkits(): Promise<ToolkitListItem[]> {
  const now = Date.now();
  if (toolkitCache && toolkitCache.expiresAt > now) {
    return toolkitCache.value;
  }

  try {
    const composio = getComposio();
    // `toolkits.get()` with no query returns the whole list.
    const response = await composio.toolkits.get();
    // The response shape varies across Composio SDK versions —
    // either an array directly, or an object with an `items` array.
    // Defensive extract so a minor-version bump doesn't break us.
    const items: unknown[] = Array.isArray(response)
      ? response
      : Array.isArray((response as { items?: unknown[] })?.items)
        ? (response as { items: unknown[] }).items
        : [];

    const trimmed: ToolkitListItem[] = [];
    for (const raw of items) {
      const t = raw as {
        slug?: string;
        name?: string;
        meta?: {
          logo?: string;
          description?: string;
          categories?: Array<{ slug?: string; name?: string }>;
        };
      };
      if (!t.slug || !t.name) continue;
      // Chat SDK owns these channels — see chat-channels.ts.
      if (CHAT_SDK_CHANNEL_SLUGS.has(t.slug)) continue;
      const item: ToolkitListItem = { slug: t.slug, name: t.name };
      if (t.meta?.logo) item.logo = t.meta.logo;
      if (t.meta?.description) item.description = t.meta.description;
      const firstCategory = t.meta?.categories?.[0]?.name;
      if (firstCategory) item.category = firstCategory;
      trimmed.push(item);
    }
    trimmed.sort((a, b) => a.name.localeCompare(b.name));

    toolkitCache = {
      value: trimmed,
      expiresAt: now + TOOLKIT_CACHE_TTL_MS,
    };
    return trimmed;
  } catch (err) {
    console.error("[composio/toolkits] Failed to list toolkits:", err);
    return [];
  }
}

export type ToolkitConnectionStatus = {
  slug: string;
  /** "connected" = at least one ACTIVE connection exists for this (identity, toolkit). */
  status: "connected" | "needs_auth";
  /**
   * Human-readable account label (e.g. `sales@acme.com`,
   * `acme-workspace.slack.com`, `acme-engineering`, or a fallback
   * like `#uDW6-TY` when we can't find anything better).
   *
   * Extraction priority (in order):
   *   1. Composio's top-level `alias` field (set by the project; the
   *      canonical "display name" per the SDK types).
   *   2. Provider-specific identifier fields from the connection
   *      `state` payload — email, team name, workspace, organization,
   *      subdomain, domain, login, etc. See `LABEL_FIELD_CANDIDATES`
   *      below for the full ordered list.
   *   3. Last 6 chars of the connection ID (`#uDW6-TY`) as a
   *      fallback so users can at least DISTINGUISH two connections
   *      to the same toolkit if they exist.
   *
   * Only undefined if we literally can't produce ANY identifier,
   * which shouldn't happen in practice.
   */
  accountLabel?: string;
  /**
   * The Composio connection ID (e.g. `ca_uDW6-TYoqjqh`). Needed
   * by the disconnect flow to identify which account to delete.
   * Present whenever `status === "connected"`.
   */
  connectionId?: string;
};

/**
 * Ordered list of field names to probe inside a connection's `state`
 * payload (and known nested containers — see `NESTED_CONTAINER_KEYS`)
 * when extracting a human-readable label. First hit wins.
 *
 * These are provider-specific fields that Composio surfaces in the
 * connection state after OAuth completes. Different OAuth providers
 * return different identifying info; this list is curated from the
 * Oauth2ActiveConnectionData schema plus observed real-world shapes.
 *
 * Both snake_case and camelCase variants are listed because Composio
 * passes through the upstream provider's field names verbatim — Linear
 * uses `displayName` (GraphQL convention), Slack uses `team_name`.
 *
 * Ordering rationale: **most specific first**. `email` wins over
 * `organization_name` because an email uniquely identifies a user;
 * an organization name is the same for everyone in a workspace.
 * `alias` (handled separately at the top level) wins over everything
 * because it's Composio's official display field.
 */
const LABEL_FIELD_CANDIDATES: readonly string[] = [
  // User-level identifier (uniquely identifies a person)
  "email",
  // Friendly user/account name — high signal, low ambiguity
  "displayName",
  "display_name",
  "fullName",
  "full_name",
  "name",
  // Handles / logins
  "username",
  "user_name",
  "login",
  "user",
  // Account / org-level identifiers
  "accountName",
  "account_name",
  "organizationName",
  "organization_name",
  "orgName",
  "org_name",
  "organization",
  "org",
  "workspaceName",
  "workspace_name",
  "workspace",
  "teamName",
  "team_name",
  "team",
  // URL / domain fields (decent fallback — at least tells you which instance)
  "accountUrl",
  "account_url",
  "subdomain",
  "domain",
  "siteName",
  "site_name",
  "instanceName",
  "urlKey",
  "url_key",
  // Internal IDs (last before the connection-ID fallback)
  "accountId",
  "account_id",
];

/**
 * Known nested container keys we'll recurse into when searching for a
 * label. ANY key outside this list is treated as a leaf — so we never
 * accidentally pick up `state.toolkit.name = "Linear"` (which is the
 * integration name, not the connected account name).
 *
 * The recursion is bounded: we look one level into containers found in
 * `state`, and one more level inside those. That's enough to handle:
 *
 *   - Slack: `state.authed_user.email`
 *   - Linear: `state.viewer.displayName` or `state.val.viewer.email`
 *   - GitHub: `state.user.login`
 *   - HubSpot: `state.val.user.email`
 *
 * If we keep hitting the ID fallback for a new provider, the debug log
 * in `extractLabel` will print `state` keys so we know what to add.
 */
const NESTED_CONTAINER_KEYS: readonly string[] = [
  "val", // Composio sometimes wraps state in `val`
  "authed_user", // Slack OAuth response
  "viewer", // Linear / generic GraphQL convention
  "user",
  "me",
  "profile",
  "account",
  "team",
  "workspace",
  "organization",
];

/**
 * Return the connection status for each requested toolkit under the
 * given per-agent identity. The only place (aside from session.ts)
 * that uses `composioIdentityFor()` — keeps the UI and runtime in
 * lockstep agreement about who owns what.
 *
 * Soft-fails to an all-`needs_auth` response on API error so the UI
 * stays responsive.
 */
export async function getConnectionStatus(params: {
  userId: string;
  agentId: string;
  toolkits: string[];
}): Promise<ToolkitConnectionStatus[]> {
  const { userId, agentId, toolkits } = params;
  if (toolkits.length === 0) return [];

  const identity = composioIdentityFor(userId, agentId);

  try {
    const composio = getComposio();
    const res = await composio.connectedAccounts.list({
      userIds: [identity],
      toolkitSlugs: toolkits,
      statuses: ["ACTIVE"],
    });

    // Map the SDK response defensively — the exposed shape is a zod
    // inferred type and may have wrapper keys across versions.
    const items: unknown[] = Array.isArray(res)
      ? res
      : Array.isArray((res as { items?: unknown[] })?.items)
        ? (res as { items: unknown[] }).items
        : [];

    // Build a slug → { label, connectionId } map from the ACTIVE
    // accounts. First ACTIVE wins (Composio may return multiple
    // in pathological cases — we take the first).
    const entries = new Map<
      string,
      { label: string | undefined; connectionId: string | undefined }
    >();
    for (const raw of items) {
      const acc = raw as {
        id?: string;
        alias?: string | null;
        toolkit?: { slug?: string };
        data?: Record<string, unknown>;
        state?: Record<string, unknown>;
      };
      const slug = acc.toolkit?.slug;
      if (!slug) continue;
      if (entries.has(slug)) continue; // first ACTIVE wins

      const label = extractLabel(acc);
      entries.set(slug, {
        label,
        connectionId: acc.id,
      });
    }

    return toolkits.map((slug) => {
      const entry = entries.get(slug);
      if (!entry) {
        return { slug, status: "needs_auth" as const };
      }
      return {
        slug,
        status: "connected" as const,
        accountLabel: entry.label,
        connectionId: entry.connectionId,
      };
    });
  } catch (err) {
    console.error("[composio/toolkits] Failed to fetch connection status:", err);
    return toolkits.map((slug) => ({ slug, status: "needs_auth" as const }));
  }
}

/**
 * Extract the best human-readable label from a connected account
 * payload. See `ToolkitConnectionStatus.accountLabel` for the
 * priority order. Returns undefined only if nothing usable found
 * anywhere — which is rare because the ID fallback almost always
 * fires.
 */
function extractLabel(acc: {
  id?: string;
  alias?: string | null;
  data?: Record<string, unknown>;
  state?: Record<string, unknown>;
}): string | undefined {
  // Priority 1: Composio's canonical alias field.
  if (typeof acc.alias === "string" && acc.alias.length > 0) {
    return acc.alias;
  }

  // Priority 2: provider-specific identifier fields, walking known
  // nested containers. We collect every container we'll search FIRST,
  // then iterate the candidate field list across all of them — so
  // candidate priority (e.g. `email` beats `name`) is preserved even
  // when the matches live at different depths.
  const state = (acc.state ?? acc.data ?? {}) as Record<string, unknown>;
  const targets = collectSearchTargets(state);

  for (const key of LABEL_FIELD_CANDIDATES) {
    for (const target of targets) {
      const v = target[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }

  // Priority 3: short connection ID — ugly but distinct, so two
  // connections to the same toolkit are still distinguishable. Log
  // the state keys (without values, to avoid leaking PII) so we can
  // see what we're missing for the next provider.
  if (typeof acc.id === "string" && acc.id.length > 0) {
    console.warn(
      "[composio/toolkits] No label found for connection",
      acc.id,
      "— state keys:",
      Object.keys(state),
      "container keys present:",
      NESTED_CONTAINER_KEYS.filter(
        (k) => k in state && state[k] && typeof state[k] === "object",
      ),
    );
    return `#${acc.id.slice(-8)}`;
  }

  return undefined;
}

/**
 * Build the ordered list of objects to scan for a label. Starts with
 * `state` itself, then adds any known nested container present at the
 * top level, then any known container present one level deeper. This
 * is bounded recursion — strictly two levels via the
 * `NESTED_CONTAINER_KEYS` allowlist — so we can't accidentally walk
 * the entire account graph.
 */
function collectSearchTargets(
  state: Record<string, unknown>,
): Record<string, unknown>[] {
  const targets: Record<string, unknown>[] = [state];

  const enqueueContainersOf = (obj: Record<string, unknown>) => {
    for (const key of NESTED_CONTAINER_KEYS) {
      const v = obj[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        targets.push(v as Record<string, unknown>);
      }
    }
  };

  enqueueContainersOf(state);
  // One more level: walk into containers we already enqueued so we can
  // reach things like `state.val.viewer.email`. Snapshot the list first
  // to avoid iterating containers we add inside this loop.
  for (const t of targets.slice(1)) enqueueContainersOf(t);

  return targets;
}
