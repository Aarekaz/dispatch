"use client";

import { useEffect, useState } from "react";

/**
 * Advance through a fixed set of frame indices on an interval timer.
 *
 * Used by the Unicode spinner variants (`Spinner`, `StatusIndicator`,
 * `RunStatusIndicator`) that cycle through short arrays of glyphs to
 * produce a monochrome animated loading state. Extracting the
 * setInterval lifecycle here keeps the consumer components free of
 * direct `useEffect` calls.
 *
 * When `enabled` is false (or the frame array has <= 1 entries) the
 * hook short-circuits: it returns frame 0 and does not register a
 * timer. Useful for status indicators where one variant animates
 * (e.g. "running") and another doesn't (e.g. "completed"), without
 * making the consumer branch on that inside an effect.
 */
export function useAnimatedFrame(
  framesLength: number,
  interval: number,
  enabled: boolean = true,
): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!enabled || framesLength <= 1) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % framesLength),
      interval,
    );
    return () => clearInterval(timer);
  }, [enabled, framesLength, interval]);
  return frame;
}
