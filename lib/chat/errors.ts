/**
 * Runtime error classification and user-facing copy.
 *
 * ── Why this module exists ───────────────────────────────────
 *
 * Every agent run that fails produces raw text from some upstream
 * system we don't control — OpenCode, OpenRouter, Anthropic, etc.
 * That text is:
 *
 *   1. **Leaky**  — it references internal runtime names, provider
 *                   URLs, user IDs, and JSON shapes that users should
 *                   never see. Shipping it into Slack is a trust hit.
 *
 *   2. **Lossy if we hand-format it** — the earlier `?? "Session error"`
 *      fallback silently discarded every non-standard payload shape.
 *      Users and admins lost all diagnostic signal.
 *
 *   3. **Inconsistent across code paths** — a bug that shows up once
 *      in Slack and once in the Activity feed should use the same
 *      label, the same ref ID, and the same admin guidance. Hand-
 *      crafted strings at each call site drift.
 *
 * This module solves all three by centralizing:
 *
 *   • A stable taxonomy (`ErrorCategory`) that drives UI labels AND
 *     maps cleanly onto Sentry/PostHog taxonomies for future wiring.
 *   • Pure classification (`classifyRuntimeError`) — deterministic,
 *     trivially unit-testable, no side effects, no dependencies.
 *
 * The side-effect boundary (`reportFailure`) lives in a separate
 * server-only module at `lib/chat/error-reporter.ts` to keep this
 * file client-safe. The Activity UI on `/[agentId]/activity` imports
 * `categoryLabel` / `categoryGuidance` from here — if this file had
 * `import "server-only"`, the build would reject that import chain.
 *
 * ── Adding a new category ────────────────────────────────────
 *
 * Three edits in THIS file:
 *   1. Add the variant to `ErrorCategory`
 *   2. Add an entry to `CATEGORY_META`
 *   3. Add a matcher to `MATCHERS`
 *
 * Nothing else in the codebase needs to change. The UI consumes
 * `CATEGORY_META` dynamically via `categoryLabel` / `categoryGuidance`.
 */

// ── Taxonomy ──────────────────────────────────────────────────
//
// Chosen to align with both (a) what admins need to DO about the
// error (top up, rotate key, retry, wait, report) and (b) the
// grouping taxonomies Sentry and PostHog use so future observability
// integrations get sensible out-of-the-box dashboards.
//
// `unknown` is the default fallback. Every unmatched payload lands
// here and shows the user a generic message while preserving the full
// raw payload in `adminDetail` for investigation.
export type ErrorCategory =
  | "quota"
  | "auth"
  | "rate_limit"
  | "model_unavailable"
  | "timeout"
  | "sandbox"
  | "network"
  | "content_filter"
  | "unknown";

// ── Classified result shape ───────────────────────────────────
//
// The one object every downstream consumer reads. All fields are
// required because consumers can always rely on this existing after
// `classifyRuntimeError` or `reportFailure` returns.
export type ClassifiedError = {
  /** Stable enum — drives UI label/guidance lookup and observability grouping. */
  category: ErrorCategory;
  /** Admin-facing category name ("Billing issue", "Authentication"). No implementation leakage. */
  label: string;
  /** Full user-facing message with agent name and correlation ID already interpolated. */
  userMessage: string;
  /** Actionable guidance paragraph shown in the admin panel. */
  adminGuidance: string;
  /** Raw provider/runtime payload, preserved verbatim. */
  adminDetail: string;
  /** 5-char base36 ref. Appears in the Slack message, Convex row, and Vercel logs. */
  correlationId: string;
};

// ── Per-category metadata ─────────────────────────────────────
//
// Keeping label/template/guidance together in ONE place means copy
// changes are a single-file edit. Templates take the agent name and
// correlation ID so callers don't concatenate strings themselves.
type CategoryMeta = {
  label: string;
  userTemplate: (agentName: string, correlationId: string) => string;
  adminGuidance: string;
};

const CATEGORY_META: Record<ErrorCategory, CategoryMeta> = {
  quota: {
    label: "Billing issue",
    userTemplate: (agent, ref) =>
      `${agent} is temporarily unavailable due to a billing issue (ref: ${ref}). Your admin has been notified.`,
    adminGuidance:
      "This agent's AI provider account is out of credits or has hit its monthly limit. Top up the account to restore service.",
  },
  auth: {
    label: "Authentication",
    userTemplate: (agent, ref) =>
      `${agent} couldn't reach its AI provider (ref: ${ref}). Your admin has been notified.`,
    adminGuidance:
      "The provider's API credentials appear invalid or revoked. Check the relevant environment variable and regenerate the key if needed.",
  },
  rate_limit: {
    label: "Rate limited",
    userTemplate: (agent, ref) =>
      `${agent} is handling a lot of requests right now (ref: ${ref}). Please try again in a moment.`,
    adminGuidance:
      "The provider is throttling requests from this agent. This usually resolves within minutes without action. If it persists, consider upgrading the provider tier.",
  },
  model_unavailable: {
    label: "Model unavailable",
    userTemplate: (agent, ref) =>
      `${agent} is temporarily unavailable (ref: ${ref}). Please try again in a moment.`,
    adminGuidance:
      "The configured model is not responding — it may be deprecated, decommissioned, or temporarily down. Try switching to a different model in the agent settings.",
  },
  timeout: {
    label: "Timeout",
    userTemplate: (agent, ref) =>
      `${agent} took too long to respond (ref: ${ref}). Please try again.`,
    adminGuidance:
      "The agent's response exceeded the platform's time budget. Check if the agent is stuck on a slow tool call or a long-running operation.",
  },
  sandbox: {
    label: "Compute environment",
    userTemplate: (agent, ref) =>
      `${agent} couldn't start up (ref: ${ref}). Your admin has been notified.`,
    adminGuidance:
      "The agent's sandbox failed to start or crashed mid-run. Check the sandbox status and consider re-provisioning if this persists.",
  },
  network: {
    label: "Network",
    userTemplate: (agent, ref) =>
      `${agent} had trouble reaching its provider (ref: ${ref}). Please try again.`,
    adminGuidance:
      "A network error occurred between the agent runtime and its AI provider. Usually transient — retry first, investigate only if recurring.",
  },
  content_filter: {
    label: "Content filter",
    userTemplate: (agent, ref) =>
      `${agent} couldn't respond to that message (ref: ${ref}).`,
    adminGuidance:
      "The provider's safety filters blocked the response. Review the conversation and adjust the prompt or switch to a less restrictive model if appropriate.",
  },
  unknown: {
    label: "Unknown error",
    userTemplate: (agent, ref) =>
      `${agent} hit an unexpected error (ref: ${ref}). Please try again — if it keeps happening, let your admin know.`,
    adminGuidance:
      "We haven't seen this error shape before. The full payload is in the Technical detail section below — share it with support if you need help.",
  },
};

// ── Pattern matchers (data-driven, append-only to extend) ─────
//
// Each matcher runs against the lowercased raw error string. First
// match wins — order by specificity (most specific at the top).
// Everything unmatched falls through to `unknown`.
const MATCHERS: Array<{
  category: ErrorCategory;
  matches: (lower: string) => boolean;
}> = [
  {
    category: "quota",
    matches: (r) =>
      r.includes("requires more credits") ||
      r.includes("insufficient credit") ||
      r.includes("monthly limit") ||
      r.includes("quota exceeded") ||
      r.includes("out of credits") ||
      r.includes("payment required") ||
      r.includes('"statuscode":402') ||
      r.includes("status code 402"),
  },
  {
    category: "auth",
    matches: (r) =>
      r.includes("invalid api key") ||
      r.includes("invalid_api_key") ||
      r.includes("unauthorized") ||
      r.includes("authentication failed") ||
      r.includes('"statuscode":401') ||
      r.includes('"statuscode":403') ||
      r.includes("status code 401") ||
      r.includes("status code 403") ||
      r.includes("not_authed"),
  },
  {
    category: "rate_limit",
    matches: (r) =>
      r.includes("rate limit") ||
      r.includes("rate_limit") ||
      r.includes("too many requests") ||
      r.includes('"statuscode":429') ||
      r.includes("status code 429"),
  },
  {
    category: "model_unavailable",
    matches: (r) =>
      r.includes("model not found") ||
      r.includes("model_not_found") ||
      r.includes("unknown model") ||
      r.includes("deprecated") ||
      r.includes("no route") ||
      r.includes('"statuscode":404'),
  },
  {
    category: "content_filter",
    matches: (r) =>
      r.includes("content filter") ||
      r.includes("content_filter") ||
      r.includes("safety") ||
      r.includes("blocked by") ||
      r.includes("moderation"),
  },
  {
    category: "timeout",
    matches: (r) =>
      r.includes("timeout") ||
      r.includes("timed out") ||
      r.includes("aborted") ||
      r.includes("deadline exceeded"),
  },
  {
    category: "sandbox",
    matches: (r) =>
      r.includes("sandbox") ||
      r.includes("daytona") ||
      r.includes("opencode server did not start") ||
      r.includes("session not found"),
  },
  {
    category: "network",
    matches: (r) =>
      r.includes("econnreset") ||
      r.includes("enotfound") ||
      r.includes("etimedout") ||
      r.includes("fetch failed") ||
      r.includes("network error"),
  },
];

// ── Correlation ID generator ──────────────────────────────────
//
// 5 characters of base36 = 60.4M possible values. That's plenty for
// per-agent dedupe in normal operation AND short enough that users
// can reliably say them out loud when reporting an issue.
//
// Uses `crypto.getRandomValues` (Web Crypto, available on Node 19+
// and all Vercel runtimes) rather than `Math.random` so IDs aren't
// predictable and won't collide under concurrent failures.
export function generateCorrelationId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  // Build a base36 string from the 32 bits, then take the last 5 chars.
  // This gives a uniform distribution over 36^5 = 60.4M possibilities.
  const num =
    (bytes[0]! << 24) |
    (bytes[1]! << 16) |
    (bytes[2]! << 8) |
    bytes[3]!;
  // Unsigned right-shift to keep the value positive after the OR.
  const unsigned = num >>> 0;
  return unsigned.toString(36).padStart(5, "0").slice(-5);
}

// ── Pure classifier ───────────────────────────────────────────
//
// Deterministic, no side effects, no external dependencies. Safe to
// unit-test with raw strings. Feed it:
//
//   • `raw`          — the brief error string (used for pattern match)
//   • `adminDetail`  — the full pretty-printed payload (preserved as-is)
//   • `agentName`    — interpolated into the user-visible message
//
// Returns a `ClassifiedError` with a freshly generated correlation
// ID. If you already have a correlation ID from upstream, pass it via
// `overrideCorrelationId` so the same ref flows across layers.
export function classifyRuntimeError(
  raw: string,
  adminDetail: string,
  agentName: string,
  overrideCorrelationId?: string,
): ClassifiedError {
  const lower = raw.toLowerCase();
  const match = MATCHERS.find((m) => m.matches(lower));
  const category: ErrorCategory = match?.category ?? "unknown";
  const meta = CATEGORY_META[category];
  const correlationId = overrideCorrelationId ?? generateCorrelationId();
  return {
    category,
    label: meta.label,
    userMessage: meta.userTemplate(agentName, correlationId),
    adminGuidance: meta.adminGuidance,
    adminDetail,
    correlationId,
  };
}

// ── Lookup helpers for the UI ─────────────────────────────────
//
// Used by `agent-error-detail.tsx` to render labels and guidance
// for historical runs. Defensive against undefined / unknown
// categories — falls back to the `unknown` metadata so pre-
// commit rows that don't have `errorCategory` still render
// something reasonable.
//
// These helpers are the reason this entire module must stay
// client-safe (no `server-only` import). They're imported by
// the Activity UI which renders inside a `"use client"` boundary.
// The side-effect `reportFailure` lives in the sibling file
// `lib/chat/error-reporter.ts` which CAN be server-only.
export function categoryLabel(category: string | undefined): string {
  return CATEGORY_META[(category as ErrorCategory) ?? "unknown"]?.label ??
    CATEGORY_META.unknown.label;
}

export function categoryGuidance(category: string | undefined): string {
  return CATEGORY_META[(category as ErrorCategory) ?? "unknown"]?.adminGuidance ??
    CATEGORY_META.unknown.adminGuidance;
}
