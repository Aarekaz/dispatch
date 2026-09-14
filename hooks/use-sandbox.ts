"use client";

import { useCallback, useEffect, useState } from "react";

/* ── useSandbox ──────────────────────────────────────────── */
//
// Polls /api/agents/[id]/sandbox at a steady interval and exposes the
// live Daytona state plus action handlers (refresh / stop / restart).
//
// Polling stops automatically when the consumer unmounts. The hook is
// resilient to in-flight races (concurrent stop + refresh, etc.) and
// pauses while the page is in the background to avoid wasted requests.

export type SandboxState = {
  state: string;
  previewUrl: string | null;
  cpu: number | null;
  gpu: number | null;
  memory: number | null;
  disk: number | null;
  target: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  autoStopInterval: number | null;
  errorReason: string | null;
};

const POLL_INTERVAL_MS = 8_000;

export function useSandbox(agentId: string): {
  data: SandboxState | null;
  isLoading: boolean;
  error: string | null;
  isMutating: boolean;
  refresh: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
} {
  const [data, setData] = useState<SandboxState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/sandbox`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as SandboxState;
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  // Initial fetch + polling loop. Pauses while the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document === "undefined" || !document.hidden) {
        await fetchState();
      }
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchState, agentId]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchState();
  }, [fetchState]);

  const mutate = useCallback(
    async (path: "stop" | "restart") => {
      setIsMutating(true);
      setError(null);
      try {
        const res = await fetch(`/api/agents/${agentId}/${path}`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        // Re-read state after a short delay so Daytona has time to settle.
        await new Promise((r) => setTimeout(r, 750));
        await fetchState();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsMutating(false);
      }
    },
    [agentId, fetchState],
  );

  const stop = useCallback(() => mutate("stop"), [mutate]);
  const restart = useCallback(() => mutate("restart"), [mutate]);

  return { data, isLoading, error, isMutating, refresh, stop, restart };
}
