"use client";

import { useState } from "react";

import { categoryGuidance, categoryLabel } from "@/lib/chat/errors";
import type { AgentRun } from "@/lib/types";

/**
 * Expanded failure detail card, rendered inline below a failed run
 * in the Activity table on `/[agentId]/activity`.
 *
 * ── What this component is for ───────────────────────────────
 *
 * Admins debugging a failed agent run need three things in order of
 * increasing technical depth:
 *
 *   1. **"What kind of problem is this?"** — category label
 *      ("Billing issue", "Authentication", etc.). Zero jargon.
 *
 *   2. **"What do I do about it?"** — actionable guidance paragraph.
 *      Points at the concrete next step (top up credits, rotate key,
 *      wait and retry, etc.) without naming the internal runtime.
 *
 *   3. **"What actually broke?"** — raw provider/runtime payload,
 *      collapsed by default. For copy-paste into a bug report.
 *
 * Two levels of progressive disclosure: the parent row is the first
 * click (collapses/expands this whole card), and the "Technical
 * detail" summary here is the second click (collapses/expands the
 * raw payload).
 *
 * ── Why the label/guidance come from the classifier module ───
 *
 * `categoryLabel` and `categoryGuidance` live in `lib/chat/errors.ts`
 * so that adding a new error category is a single-file edit. This
 * component is intentionally dumb — it reads those helpers, falls
 * back to generic copy when `errorCategory` is missing (pre-commit
 * rows), and renders. Zero switch statements, zero coupling to the
 * taxonomy.
 */
export function AgentErrorDetail({ run }: { run: AgentRun }) {
  const label = categoryLabel(run.errorCategory);
  const guidance = categoryGuidance(run.errorCategory);

  return (
    <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      {/* ── Header: category label + correlation ID ─── */}
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-destructive">
          {label}
        </span>
        {run.correlationId && (
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            ref {run.correlationId}
          </span>
        )}
      </div>

      {/* ── Admin guidance paragraph ─── */}
      <p className="mt-2 text-sm leading-relaxed text-foreground">{guidance}</p>

      {/* ── Metadata grid ─── */}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <dt>When</dt>
        <dd className="tabular-nums">{run.startedAt}</dd>
        {run.channel && (
          <>
            <dt>Channel</dt>
            <dd className="capitalize">{run.channel}</dd>
          </>
        )}
        {run.sessionId && (
          <>
            <dt>Session</dt>
            <dd className="truncate font-mono text-xs">{run.sessionId}</dd>
          </>
        )}
      </dl>

      {/* ── Collapsible technical detail ─── */}
      {run.errorDetail && <TechnicalDetail detail={run.errorDetail} />}
    </div>
  );
}

/* ── Technical detail pane ──────────────────────────────────── */
//
// Collapsed by default so non-technical admins aren't confronted
// with a wall of JSON. When expanded, shows the raw payload in a
// monospace scroll pane with a Copy button.

function TechnicalDetail({ detail }: { detail: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      // Clear the "Copied!" affordance after a short window so the
      // user can copy again if they need to. 1.5s matches the
      // shadcn toast default dismissal timing.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API can reject (insecure context, permission),
      // silently no-op — the payload is still visible on screen.
    }
  };

  return (
    <details className="group mt-3">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>{" "}
        Technical detail
      </summary>
      <div className="mt-2 overflow-hidden rounded-md border border-border bg-muted/30">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Raw payload
          </span>
          <button
            type="button"
            onClick={copy}
            className="min-w-16 rounded-sm px-2 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="max-h-60 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground">
          {detail}
        </pre>
      </div>
    </details>
  );
}
