"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { AgentErrorDetail } from "@/components/agent-management/agent-error-detail";
import { ChannelPill } from "@/components/ui/channel-pill";
import { RunStatusIndicator } from "@/components/ui/unicode-spinner";
import { TriggerBadge, capitalize } from "@/components/ui/trigger-badge";
import { relativeTime } from "@/lib/utils";
import type { AgentRun } from "@/lib/types";

/**
 * The canonical activity row — used by both the `/activity` page
 * and the home page's activity feed. Keeps visual language in sync
 * across every surface that shows "what the agent has been doing."
 *
 * Three visual states:
 *   • completed / running → clickable link into the originating session
 *   • failed             → expandable button that reveals the error card
 *
 * The status dot on the left always distinguishes them even when collapsed.
 */
export function ActivityRow({
  agentId,
  run,
  startedAtMs,
}: {
  agentId: string;
  run: AgentRun;
  /**
   * Raw timestamp in milliseconds. Used to render a relative time
   * ("2h ago") — preferred over the pre-formatted `run.startedAt`
   * string since relative time is more scannable in a dense list.
   */
  startedAtMs: number;
}) {
  const isFailed = run.status === "failed";
  return isFailed ? (
    <FailedRow run={run} startedAtMs={startedAtMs} />
  ) : (
    <SuccessRow agentId={agentId} run={run} startedAtMs={startedAtMs} />
  );
}

/* ── Completed / running ── */

function SuccessRow({
  agentId,
  run,
  startedAtMs,
}: {
  agentId: string;
  run: AgentRun;
  startedAtMs: number;
}) {
  const isAutomation = run.trigger === "automation" && run.automationId;
  // Automation detail lives under the workspace route so the user
  // keeps the dock + sandbox pill + agent switcher. Without the
  // agentId prefix, the legacy dashboard shell renders it instead.
  const href = (isAutomation
    ? `/${agentId}/automations/${run.automationId}`
    : run.sessionId
      ? `/${agentId}/home?session=${run.sessionId}`
      : `/${agentId}/home`) as Route;

  const inferredChannel = resolveChannel(run);
  const actionText = isAutomation
    ? run.summary || `via ${run.automationName ?? "automation"}`
    : run.summary ||
      run.sessionTitle ||
      `${capitalize(run.trigger)}-triggered run`;

  const totalTokens = run.tokensIn + run.tokensOut;
  const hasDuration = Boolean(run.duration);
  const hasTokens = totalTokens > 0;
  const showMeta = hasDuration || hasTokens;

  return (
    <li>
      <Link
        href={href}
        className="-mx-3 flex items-start gap-3 rounded-lg px-3 py-2 outline-none transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <RunStatusIndicator status={run.status} />
        <div className="w-20 shrink-0">
          {isAutomation ? (
            <span className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              Auto
            </span>
          ) : inferredChannel ? (
            <ChannelPill channel={inferredChannel} />
          ) : (
            <TriggerBadge trigger={run.trigger} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-relaxed text-foreground">
            {actionText}
          </p>
          {showMeta && (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {hasDuration && run.duration}
              {hasDuration && hasTokens && " · "}
              {hasTokens && `${totalTokens.toLocaleString()} tokens`}
            </p>
          )}
        </div>
        <time
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          dateTime={new Date(startedAtMs).toISOString()}
        >
          {relativeTime(startedAtMs)}
        </time>
      </Link>
    </li>
  );
}

/* ── Failed ── */

function FailedRow({
  run,
  startedAtMs,
}: {
  run: AgentRun;
  startedAtMs: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const inferredChannel = resolveChannel(run);
  const actionText =
    run.summary || `${capitalize(run.trigger)}-triggered run failed`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="-mx-3 flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <RunStatusIndicator status={run.status} />
        <div className="w-20 shrink-0">
          {inferredChannel ? (
            <ChannelPill channel={inferredChannel} />
          ) : (
            <TriggerBadge trigger={run.trigger} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-relaxed text-foreground">
            {actionText}
          </p>
          {run.correlationId && (
            <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
              ref {run.correlationId}
            </p>
          )}
        </div>
        <time
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          dateTime={new Date(startedAtMs).toISOString()}
        >
          {relativeTime(startedAtMs)}
        </time>
      </button>
      {expanded && (
        <div className="-mx-3 px-3">
          <AgentErrorDetail run={run} />
        </div>
      )}
    </li>
  );
}

/* ── Helpers ── */

export function resolveChannel(run: AgentRun): string | null {
  if (run.channel) return run.channel;
  // Backfill: chat/webhook runs are web conversations even if they
  // predate the `channel` field migration.
  if (run.trigger === "chat" || run.trigger === "webhook") return "web";
  return null;
}
