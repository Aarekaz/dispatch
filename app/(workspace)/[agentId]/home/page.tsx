"use client";

import { useCallback } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAgent } from "@/hooks/use-agents";
import { channelLabel } from "@/lib/channels";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentChat } from "@/components/agent-chat";
import { ActivityRow } from "@/components/activity/activity-row";
import type { AgentRun } from "@/lib/types";

/**
 * Agent home — renders the chat interface directly.
 *
 * The chat's empty/greeting state is customized with:
 *   • heroSlot — dynamic status headline (today's activity summary)
 *   • bottomSlot — recent activity feed (cross-channel)
 *
 * Sending a message transitions to the chat thread (existing AgentChat flow).
 *
 * Query params:
 *   ?session=<id>  load a specific session directly
 */
export default function AgentHomePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const router = useRouter();
  const { data: agent, isLoading } = useAgent(agentId);

  // Keep the URL in sync with the active session so the breadcrumb
  // can show the session title and links stay shareable.
  const handleSessionChange = useCallback(
    (newSessionId: string | null) => {
      const url = (newSessionId
        ? `/${agentId}/home?session=${newSessionId}`
        : `/${agentId}/home`) as Route;
      router.replace(url, { scroll: false });
    },
    [agentId, router],
  );

  // Live runs from Convex (reactive — updates instantly).
  // Skip on demo routes whose agentId isn't a Convex id.
  const runs = useQuery(
    api.runs.list,
    /^[a-z0-9]{32}$/.test(agentId)
      ? { agentId: agentId as Id<"agents"> }
      : "skip",
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Agent not found. It may have been removed.
        </p>
      </div>
    );
  }

  // Today's unique conversations (deduplicated by session)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayRuns = (runs ?? []).filter(
    (r) => r.startedAt >= todayStart.getTime(),
  );
  const todayConversations = new Set(
    todayRuns.map((r) => r.sessionId ?? r._id),
  ).size;

  // Channels active for this agent (fall back to "web" if none set)
  const activeChannels = [
    ...new Set(agent.channels.length > 0 ? agent.channels : ["web"]),
  ];

  // Recent activity — dedupe runs by session, take top 5
  const recentActivity = dedupeBySession(runs ?? [], 5);

  // Hero — replaces "Let's get started" in the greeting
  const headline = (
    <h1 className="font-serif text-2xl font-light leading-snug tracking-tight text-foreground/80 md:text-[28px]">
      Today,{" "}
      <span className="font-normal text-foreground">{agent.name}</span> handled{" "}
      <span className="font-normal text-foreground">{todayConversations}</span>{" "}
      {todayConversations === 1 ? "conversation" : "conversations"} across{" "}
      <span className="font-normal text-foreground">
        {activeChannels.map((c) => channelLabel(c)).join(", ")}
      </span>
      .
      <br />
      <span className="text-muted-foreground/70">
        Nothing needs your attention.
      </span>
    </h1>
  );

  // Bottom — standardized ActivityRow, same component used on /activity
  const activity =
    recentActivity.length > 0 ? (
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-xs font-medium text-muted-foreground">Activity</p>
          <Link
            href={`/${agentId}/activity` as Route}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View all &rarr;
          </Link>
        </div>
        <ul className="space-y-0.5">
          {recentActivity.map((run) => {
            const mapped: AgentRun = {
              id: run._id,
              trigger: run.trigger as AgentRun["trigger"],
              channel: run.channel ?? undefined,
              sessionId: run.sessionId ?? undefined,
              sessionTitle: run.sessionTitle ?? undefined,
              automationId: run.automationId ?? undefined,
              automationName: run.automationName ?? undefined,
              status: run.status as AgentRun["status"],
              summary: run.summary ?? "",
              model: run.model ?? "",
              tokensIn: run.tokensIn ?? 0,
              tokensOut: run.tokensOut ?? 0,
              credits: run.credits ?? 0,
              startedAt: new Date(run.startedAt).toLocaleString(),
              duration: run.duration ?? "",
              errorCategory: run.errorCategory ?? undefined,
              errorDetail: run.errorDetail ?? undefined,
              correlationId: run.correlationId ?? undefined,
            };
            return (
              <ActivityRow
                key={run._id}
                agentId={agentId}
                run={mapped}
                startedAtMs={run.startedAt}
              />
            );
          })}
        </ul>
      </div>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      <AgentChat
        agentId={agentId}
        agentName={agent.name}
        agentEmoji={agent.emoji}
        agentVertical={agent.vertical}
        initialSessionId={sessionId}
        greetingHeroSlot={headline}
        greetingBottomSlot={activity}
        onSessionChange={handleSessionChange}
      />
    </div>
  );
}

/* ── Helpers ── */

function dedupeBySession<
  T extends {
    sessionId?: string | null;
    startedAt: number;
    _id: string;
  },
>(runs: T[], max: number): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const run of runs) {
    const key = run.sessionId ?? run._id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(run);
    if (result.length >= max) break;
  }
  return result;
}
