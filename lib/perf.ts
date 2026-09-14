/**
 * Lightweight performance logging utility.
 *
 * Use perfTimer() to measure durations and perfLog() for point-in-time events.
 * All output uses [perf] prefix for easy filtering: `grep '\[perf\]'`.
 *
 * Output format: [perf] <label> {"key":"value","ms":42}
 *
 * Works on both server and client (uses performance.now() which is universal).
 *
 * Correlation ID auto-injection: when running inside a
 * `withRequestContext()` block on the server, every line gets a
 * `cid` field. That makes the full timeline of one request greppable
 * across interleaved logs:
 *   `tail -f logs | grep 'cid":"abc12345"'`
 *
 * On the client (or outside a context block on the server) the cid
 * field is silently omitted — so existing call sites need no changes.
 */

type Meta = Record<string, unknown>;

/**
 * Lazy server-only import of the request-context helper. ALS only
 * exists on Node, so we fall back to undefined when this module is
 * bundled for the browser. The dynamic require keeps `perf.ts`
 * isomorphic — no top-level Node-only import.
 */
function getCidSafe(): string | undefined {
  if (typeof process === "undefined" || typeof window !== "undefined") {
    return undefined;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCid } = require("@/lib/request-context") as {
      getCid: () => string | undefined;
    };
    return getCid();
  } catch {
    return undefined;
  }
}

function formatMeta(meta?: Meta): string {
  const cid = getCidSafe();
  const merged: Meta = cid ? { cid, ...(meta ?? {}) } : (meta ?? {});
  if (Object.keys(merged).length === 0) return "";
  try {
    return " " + JSON.stringify(merged);
  } catch {
    return "";
  }
}

/**
 * Log a point-in-time event (no duration).
 * Use for milestones like "cache hit", "first token", "stream closed".
 */
export function perfLog(label: string, meta?: Meta): void {
  console.log(`[perf] ${label}${formatMeta(meta)}`);
}

/**
 * Start a timer. Call .end() to log the elapsed milliseconds.
 *
 * const timer = perfTimer("ensure-running", { sandboxId });
 * // ... do work
 * timer.end({ cacheHit: false });
 * // Logs: [perf] ensure-running {"cid":"abc12345","sandboxId":"abc","cacheHit":false,"ms":245}
 */
export function perfTimer(label: string, meta?: Meta) {
  const start = performance.now();
  return {
    /** End the timer, log the duration, return milliseconds. */
    end(extra?: Meta): number {
      const ms = Math.round(performance.now() - start);
      perfLog(label, { ...meta, ...extra, ms });
      return ms;
    },
    /** Get current elapsed ms without ending the timer. */
    elapsed(): number {
      return Math.round(performance.now() - start);
    },
    /** Log a mark relative to the timer start (useful for TTFT, step breakdowns). */
    mark(markLabel: string, extra?: Meta): number {
      const ms = Math.round(performance.now() - start);
      perfLog(`${label}:${markLabel}`, { ...meta, ...extra, ms });
      return ms;
    },
  };
}
