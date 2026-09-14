import "server-only";

import { fetchMutation } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClassifiedError } from "@/lib/chat/errors";
import { classifyRuntimeError } from "@/lib/chat/errors";
import { getSecret } from "@/lib/chat/secrets";

/**
 * Single side-effect boundary for agent-failure reporting.
 *
 * ── Why this file exists separately from `lib/chat/errors.ts` ──
 *
 * The classifier in `errors.ts` is imported by client components
 * (`agent-error-detail.tsx` uses `categoryLabel` / `categoryGuidance`
 * to render the admin panel). That means `errors.ts` must be
 * client-safe and can't have `import "server-only"`.
 *
 * But `reportFailure` uses Convex's `fetchMutation` which is
 * strictly server-side. It also reads `process.env` for the
 * internal secret. Keeping it alongside the classifier would
 * poison the import chain and break the client build.
 *
 * The split: `errors.ts` is pure TypeScript + Web APIs only.
 * This file imports from `errors.ts` and adds the server-only
 * side effects. Callers that need reporting import from HERE.
 *
 * ── The single-boundary discipline ───────────────────────────
 *
 * Every failure path in the system flows through `reportFailure`:
 *
 *   • Handler `catch` block (thrown exceptions) → `kind: "raw"`
 *   • Handler post-stream check (run.error events) → `kind: "classified"`
 *
 * That's it. Two call sites. Two shapes. One function.
 *
 * Adding Sentry, PostHog, OpenTelemetry, PagerDuty, Slack alerts,
 * or any other observability integration is a ~12-line diff INSIDE
 * this function. No grep, no refactor, no missing call sites —
 * because every failure in the system already funnels through here.
 */

// ── Input shape ───────────────────────────────────────────────
//
// Discriminated union so the type system enforces that callers
// provide EITHER a pre-classified error OR the raw material to
// classify one. No accidental silent drops of the `adminDetail`.
export type ReportFailureInput = {
  agentId: string;
  agentName: string;
  sessionId: string | null;
  channel: string;
  turnId: string;
} & (
  | { kind: "raw"; raw: string; adminDetail?: string }
  | { kind: "classified"; classified: ClassifiedError }
);

/**
 * Report an agent failure — the single side-effect boundary.
 *
 * Accepts either a pre-classified error (from the stream-bridge,
 * where classification already happened with the real agent name
 * and a chosen correlation ID) or a raw string (from the handler's
 * catch block, where we only have the thrown Error's message).
 * Internally normalizes to a `ClassifiedError` and fans out to
 * every side effect.
 *
 * ALWAYS returns the `ClassifiedError` so callers can use its
 * `userMessage` and `correlationId` in follow-up UI posts.
 */
export async function reportFailure(
  input: ReportFailureInput,
): Promise<ClassifiedError> {
  // 1. Normalize to `ClassifiedError`. If the caller already
  //    classified upstream, trust that — don't re-classify and
  //    risk a different correlation ID than the one the user saw.
  const classified: ClassifiedError =
    input.kind === "classified"
      ? input.classified
      : classifyRuntimeError(
          input.raw,
          input.adminDetail ?? input.raw,
          input.agentName,
        );

  // 2. Structured console log. The log is a single line of JSON
  //    keyed on `correlationId` so Vercel Logs (or any future log
  //    drain) can filter and route on fields. Same ID the user
  //    sees in Slack — greppable across systems.
  console.error(
    "[chat-sdk:error]",
    JSON.stringify({
      correlationId: classified.correlationId,
      category: classified.category,
      label: classified.label,
      agentId: input.agentId,
      agentName: input.agentName,
      sessionId: input.sessionId,
      channel: input.channel,
      turnId: input.turnId,
      userMessage: classified.userMessage,
      adminDetail: classified.adminDetail,
    }),
  );

  // 3. Persistent Convex record. Writes a row to `agentRuns` with
  //    `status: "failed"` and the classified diagnostic fields so
  //    the Activity table on `/[agentId]/activity` can render the
  //    failure and expand it inline to show the full detail.
  //
  //    Non-fatal on failure: if Convex is unreachable, the console
  //    log above is still the source of truth for debugging. We
  //    absolutely do NOT want the fail-in-the-fail-path anti-pattern
  //    where the error reporter itself throws.
  try {
    await fetchMutation(api.runs.logInternal, {
      agentId: input.agentId as Id<"agents">,
      sessionId: input.sessionId ?? undefined,
      trigger: "webhook",
      channel: input.channel,
      status: "failed",
      summary: classified.userMessage,
      errorCategory: classified.category,
      errorDetail: classified.adminDetail,
      correlationId: classified.correlationId,
      secret: getSecret(),
    });
  } catch (err) {
    console.error(
      "[chat-sdk:error] Convex persist failed — error still visible in log line above",
      err instanceof Error ? err.message : err,
    );
  }

  // 4. ── FUTURE: Sentry ─────────────────────────────────────
  //
  // When you're ready to add Sentry, drop in:
  //
  //   Sentry.captureException(new Error(classified.userMessage), {
  //     tags: {
  //       category: classified.category,
  //       agentId: input.agentId,
  //       channel: input.channel,
  //     },
  //     extra: {
  //       correlationId: classified.correlationId,
  //       adminDetail: classified.adminDetail,
  //       turnId: input.turnId,
  //     },
  //     // Group errors by agent + category so one broken agent
  //     // doesn't flood the Sentry UI with thousands of "same"
  //     // issues.
  //     fingerprint: [classified.category, input.agentId],
  //   });

  // 5. ── FUTURE: PostHog ────────────────────────────────────
  //
  //   posthog.capture("agent_error", {
  //     agent_id: input.agentId,
  //     category: classified.category,
  //     correlation_id: classified.correlationId,
  //     channel: input.channel,
  //   });

  return classified;
}

