"use client";

/**
 * Shared data hook for the Composio integrations UI.
 *
 * Loads the full toolkit catalog and the per-agent connection
 * status in parallel, exposes a refresh for status (catalog is
 * immutable per session so never needs refresh), and surfaces a
 * `connectionFor(slug)` lookup for render sites.
 *
 * Consumed by the workspace Connect page at `/[agentId]/connect`,
 * which renders a Communication section (channels) and a Tools
 * section (Composio toolkits). The toolkit rows come from
 * `components/connect/toolkit-action.tsx`, which reads this
 * hook's output to decide whether to show Connect or a Connected
 * dropdown per toolkit.
 *
 * The catalog fetch is cached via the API route's own caching
 * (see `lib/composio/toolkits.ts`), so calling this hook from
 * multiple components on the same page is cheap.
 */
import { useCallback, useEffect, useState } from "react";

export type ToolkitItem = {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
};

export type ConnectionStatus = {
  slug: string;
  status: "connected" | "needs_auth";
  accountLabel?: string;
  /** Composio connection ID, present when `status === "connected"`. Required for the disconnect flow. */
  connectionId?: string;
};

export type UseComposioToolkits = {
  /** Full catalog, null while loading, empty array if load failed. */
  catalog: ToolkitItem[] | null;
  /** Per-slug connection status map (only contains slugs the agent has enabled). */
  statuses: Map<string, ConnectionStatus>;
  /** Convenience lookup — returns undefined for unknown slugs. */
  connectionFor: (slug: string) => ConnectionStatus | undefined;
  /** Force a fresh fetch of the status map (call after save or after a connect completes). */
  refreshStatuses: () => Promise<void>;
  /** Distinct categories in the catalog, sorted alphabetically. Empty until catalog loads. */
  categories: string[];
  /**
   * True until the very first `refreshStatuses()` resolves. Consumers use
   * this to delay "smart default" decisions (e.g. auto-selecting the
   * Connected tab when the agent already has active connections) until
   * we actually know what's connected — otherwise the component would
   * decide based on an empty map and default wrong.
   */
  isLoadingStatuses: boolean;
};

export function useComposioToolkits(agentId: string): UseComposioToolkits {
  const [catalog, setCatalog] = useState<ToolkitItem[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ConnectionStatus>>(
    new Map(),
  );
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(true);

  // One-shot catalog load on mount. The /api/composio/toolkits route
  // aggressively caches server-side so this is cheap even if multiple
  // components mount at once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/composio/toolkits`);
        if (!res.ok) {
          if (!cancelled) setCatalog([]);
          return;
        }
        const data: { toolkits: ToolkitItem[] } = await res.json();
        if (!cancelled) setCatalog(data.toolkits);
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/composio/toolkits?status=1&agentId=${encodeURIComponent(agentId)}`,
      );
      if (!res.ok) return;
      const data: { statuses: ConnectionStatus[] } = await res.json();
      const next = new Map<string, ConnectionStatus>();
      for (const s of data.statuses) next.set(s.slug, s);
      setStatuses(next);
    } catch {
      // Best-effort. A stale status map just means the pill shows
      // "Connect" for a toolkit that's actually connected — the
      // next refresh will fix it.
    } finally {
      // Whether we succeeded or silently failed, the first attempt
      // is complete — unblock any "waiting for statuses" consumers.
      setIsLoadingStatuses(false);
    }
  }, [agentId]);

  // Initial status fetch on mount. Components that toggle toolkits
  // must call refreshStatuses() after a successful save.
  useEffect(() => {
    queueMicrotask(() => {
      void refreshStatuses();
    });
  }, [refreshStatuses]);

  const connectionFor = useCallback(
    (slug: string) => statuses.get(slug),
    [statuses],
  );

  // Derive a sorted distinct category list from the catalog so the
  // full-grid UI can render category filter chips without re-iterating.
  const categories = (() => {
    if (!catalog) return [];
    const set = new Set<string>();
    for (const t of catalog) {
      if (t.category) set.add(t.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  return {
    catalog,
    statuses,
    connectionFor,
    refreshStatuses,
    categories,
    isLoadingStatuses,
  };
}
