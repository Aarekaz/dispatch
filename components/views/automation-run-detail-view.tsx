"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  ArrowUpRight,
  WarningCircle,
} from "@phosphor-icons/react";

import { relativeTime } from "@/lib/utils";
import { deriveRunStatus, STATUS_CONFIG, getTriggerLabel } from "@/lib/automations/status";
import { useAutomationRun } from "@/hooks/use-automations";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner, RunStatusIndicator } from "@/components/ui/unicode-spinner";

export function AutomationRunDetailView({
  automationId,
  sessionId,
}: {
  automationId: string;
  sessionId: string;
}) {
  const { data, isLoading } = useAutomationRun(sessionId);

  if (isLoading) return <RunDetailSkeleton automationId={automationId} />;

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-foreground">Run not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This run may have been deleted or you don&apos;t have access.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            render={<Link href={`/automations/${automationId}` as Route} />}
          >
            <ArrowLeft className="mr-1 size-3" />
            Back to automation
          </Button>
        </div>
      </div>
    );
  }

  const { session, messages, automation, agent } = data;
  const status = deriveRunStatus(session);
  const config = STATUS_CONFIG[status];
  const isActive = status === "pending" || status === "running";
  const canViewChat = status === "completed";

  // Split messages into prompt (first user message) and response (first assistant message)
  // For persistent sessions reused across runs, get the LATEST
  // prompt and response (messages are sorted asc by createdAt).
  const promptMsg = [...messages].reverse().find((m) => m.role === "user");
  const responseMsg = [...messages].reverse().find((m) => m.role === "assistant");

  // Duration: only show when completed or failed, calculated from session timestamps
  const durationMs =
    !isActive && session.updatedAt > session.createdAt
      ? session.updatedAt - session.createdAt
      : null;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        {/* Back link */}
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/automations/${automationId}` as Route} />}
        >
          <ArrowLeft className="mr-1 size-3" />
          {automation?.name ?? "Automation"}
        </Button>

        {/* Header */}
        <div className="mt-10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {agent?.emoji && (
                <span className="text-lg">{agent.emoji}</span>
              )}
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {session.title ?? automation?.name ?? "Run"}
              </h1>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              {agent && <span>{agent.name}</span>}
              <span aria-hidden="true">·</span>
              <span>{getTriggerLabel(session.automationTrigger ?? undefined)}</span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(session.createdAt)}</span>
            </div>
          </div>

          {/* Status */}
          <div className="flex shrink-0 items-center gap-2">
            {status === "pending" ? (
              <Spinner context="booting" className="text-xs text-muted-foreground" />
            ) : status === "running" ? (
              <Spinner context="running" className="text-xs text-muted-foreground" />
            ) : (
              <RunStatusIndicator status={status} />
            )}
            <span className={`text-xs font-medium ${config.color}`}>
              {config.label}
            </span>
          </div>
        </div>

        {/* Separator */}
        <div className="my-8 border-t border-border" />

        {/* Prompt section */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Instructions
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-accent/20 px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {promptMsg?.content ?? (
                <span className="italic text-muted-foreground">
                  {status === "pending"
                    ? "Instructions will appear once the agent starts..."
                    : "No instructions recorded."}
                </span>
              )}
            </p>
          </div>
        </section>

        {/* Separator */}
        <div className="my-8 border-t border-border" />

        {/* Response section */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </h2>

          <div className="mt-3">
            {status === "pending" && (
              <PendingState />
            )}

            {status === "running" && (
              <RunningState />
            )}

            {status === "failed" && (
              <FailedState error={session.automationError ?? undefined} />
            )}

            {status === "completed" && (
              <CompletedState
                content={responseMsg?.content}
              />
            )}
          </div>
        </section>

        {/* Separator */}
        <div className="my-8 border-t border-border" />

        {/* Metadata footer */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          {durationMs !== null && (
            <span>Duration: {formatDuration(durationMs)}</span>
          )}
          {automation?.defaultDelivery &&
            (automation.defaultDelivery as { type: string }).type !== "activity_log" && (
              <span>
                Delivery:{" "}
                {(automation.defaultDelivery as { type: string }).type === "slack_channel"
                  ? "Slack"
                  : (automation.defaultDelivery as { type: string }).type}
              </span>
            )}
        </div>

        {/* View in chat link */}
        {canViewChat && (
          <div className="mt-6">
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  href={`/${session.agentId}/home?session=${session.sessionExternalId}` as Route}
                />
              }
            >
              View in chat
              <ArrowUpRight className="ml-1 size-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── State components ──────────────────────────

function PendingState() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-6">
      <Spinner context="booting" className="text-sm text-muted-foreground" />
      <div>
        <p className="text-sm text-foreground">Preparing agent</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Waking the sandbox and setting up the environment...
        </p>
      </div>
    </div>
  );
}

function RunningState() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-6">
      <Spinner context="thinking" className="text-sm text-muted-foreground" />
      <div>
        <p className="text-sm text-foreground">Agent is working</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Executing instructions. This page updates automatically.
        </p>
      </div>
    </div>
  );
}

function FailedState({ error }: { error?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
      <WarningCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>
        <p className="text-sm font-medium text-foreground">Run failed</p>
        {error && (
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    </div>
  );
}

function CompletedState({ content }: { content?: string }) {
  if (!content) {
    return (
      <p className="text-sm italic text-muted-foreground">
        The agent completed with no output.
      </p>
    );
  }

  return (
    <div className="prose prose-sm max-w-none text-foreground">
      <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

// ── Loading skeleton ────────────────────────

function RunDetailSkeleton({ automationId }: { automationId: string }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/automations/${automationId}` as Route} />}
        >
          <ArrowLeft className="mr-1 size-3" />
          Back
        </Button>
        <div className="mt-10">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
        <div className="my-8 border-t border-border" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-3 h-24 w-full" />
        <div className="my-8 border-t border-border" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-3 h-32 w-full" />
      </div>
    </div>
  );
}
