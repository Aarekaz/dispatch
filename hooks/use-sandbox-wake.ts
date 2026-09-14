"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Fire a callback when the agent's Daytona sandbox transitions from
 * any inactive state (`stopped`, `starting`, `stopping`, `unknown`)
 * to a live-running state (`running` / `started`).
 *
 * Why this hook exists: the Files page + file viewer both need to
 * refresh their data when the sandbox wakes up from elsewhere —
 * e.g. the user clicks Restart in the SandboxPill popover while
 * looking at a cached file tree. Previously each component kept its
 * own copy-pasted useEffect + useRef pair; this centralizes the
 * pattern so components can stay free of direct `useEffect` calls.
 *
 * The callback intentionally only fires on the INACTIVE → RUNNING
 * transition, never on every render or on the initial mount when
 * the sandbox is already running. Callers pass a stable reference
 * (e.g. via `useCallback`) if they rely on fresh closure state.
 */
export function useOnSandboxWake(
  sandboxState: string | undefined,
  onWake: () => void,
): void {
  const prevStateRef = useRef<string | undefined>(sandboxState);
  const onWakeEvent = useEffectEvent(onWake);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = sandboxState;
    const wasInactive =
      prev === "stopped" ||
      prev === "starting" ||
      prev === "stopping" ||
      prev === undefined;
    const nowRunning =
      sandboxState === "running" || sandboxState === "started";
    if (wasInactive && nowRunning) onWakeEvent();
  }, [sandboxState]);
}
