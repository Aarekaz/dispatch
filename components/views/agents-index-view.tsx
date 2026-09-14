"use client";

import type { Route } from "next";
import Link from "next/link";

import { useAgents } from "@/hooks/use-agents";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { ChannelPill } from "@/components/ui/channel-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/unicode-spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Agent } from "@/lib/types";

/* ── Agents index view ───────────────────────────────────── */
//
// Single scrolling page in the same aesthetic as /home, /manage,
// and /settings. The capability lens on the agent fleet: who's
// active, what roles, where they can be reached. Activity counts
// live on /home — this page deliberately doesn't duplicate them.

export function AgentsIndexView() {
  const { data: agents, isLoading } = useAgents();

  if (isLoading) return <AgentsLoadingSkeleton />;
  if (agents.length === 0) return <AgentsEmptyState />;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        {/* Top action bar */}
        <div className="flex items-center justify-end">
          <Button render={<Link href={"/agents/new" as Route} />}>
            + Create another
          </Button>
        </div>

        {/* Page title */}
        <h1 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          Your AI workforce
        </h1>

        {/* Editorial summary line — capability lens, not activity lens */}
        <p className="mt-6 max-w-2xl font-serif text-2xl font-normal leading-snug tracking-tight text-muted-foreground md:text-3xl">
          <WorkforceSummary agents={agents} />
        </p>

        {/* Reachable-on row — UNION of actually-connected channels only.
            Channels are configured per agent, so the per-row pills below
            tell the granular story. This row tells the workforce-level
            "where can my workers be reached at all" story. */}
        <div className="mt-8">
          <p className="text-xs text-muted-foreground">Reachable on</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReachableChannels agents={agents} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground/70">
            More channels coming soon — connect them per agent on each
            agent&apos;s manage page.
          </p>
        </div>

        {/* Section divider */}
        <div className="my-16" aria-hidden="true" />

        {/* Agents list */}
        <ul className="space-y-1">
          {agents.map((agent) => (
            <AgentListRow key={agent.id} agent={agent} />
          ))}
        </ul>

        {/* Bottom CTA */}
        <div className="mt-12 flex justify-center">
          <Button
            variant="outline"
            render={<Link href={"/agents/new" as Route} />}
          >
            + Create another agent
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Workforce summary copy ──────────────────────────────── */

function WorkforceSummary({ agents }: { agents: Agent[] }) {
  const count = agents.length;
  const noun = count === 1 ? "agent" : "agents";

  // Group by vertical (role) for the breakdown line
  const byRole = new Map<string, number>();
  for (const agent of agents) {
    const role = agent.vertical || "Other";
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
  }
  const roles = Array.from(byRole.entries());

  return (
    <>
      <span className="text-foreground">
        {count} {noun}
      </span>
      {roles.length > 0 && (
        <>
          {" "}— {formatRoleBreakdown(roles)}.
        </>
      )}
    </>
  );
}

function formatRoleBreakdown(roles: Array<[string, number]>): string {
  const parts = roles.map(([role, n]) => `${n} in ${role}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/* ── Reachable channels row ──────────────────────────────── */
//
// Computes the UNION of channels actually connected across all agents.
// Channels are per-agent, so this row only shows what's real somewhere
// in the fleet. For partial coverage (a channel connected to some
// but not all agents), shows a small "N of M" hint after the pill so
// the user knows it's not fleet-wide.

function ReachableChannels({ agents }: { agents: Agent[] }) {
  // Count how many agents have each channel.
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const seen = new Set(agent.channels);
    for (const channel of seen) {
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
    }
  }

  // Sort: most-covered channels first, web always first if present.
  const entries = Array.from(counts.entries()).sort((a, b) => {
    if (a[0] === "web") return -1;
    if (b[0] === "web") return 1;
    return b[1] - a[1];
  });

  if (entries.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Not reachable on any channel yet.
      </span>
    );
  }

  return (
    <>
      {entries.map(([channel, count]) => {
        const isUniversal = count === agents.length;
        const pill = <ChannelPill channel={channel} />;
        if (isUniversal) return <div key={channel}>{pill}</div>;
        return (
          <Tooltip key={channel}>
            <TooltipTrigger
              render={(props) => (
                <div {...props} className="flex items-center gap-1.5">
                  {pill}
                  <span className="text-[11px] tabular-nums text-muted-foreground/70">
                    {count} / {agents.length}
                  </span>
                </div>
              )}
            />
            <TooltipContent>
              Connected on {count} of {agents.length} agents
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}

/* ── Agent list row ──────────────────────────────────────── */

function AgentListRow({ agent }: { agent: Agent }) {
  const externalChannels = agent.channels.filter((c) => c !== "web");
  const visibleChannels = agent.channels.slice(0, 3);
  const channelOverflow = agent.channels.length - visibleChannels.length;

  return (
    <li>
      <Link
        href={`/${agent.id}/home` as Route}
        className="-mx-3 flex items-center gap-4 rounded-lg px-3 py-3 outline-none transition-colors hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <AgentAvatar name={agent.name} size="md" />

        {/* Name + role */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {agent.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">·</span>
            <span className="truncate text-xs text-muted-foreground">
              {agent.vertical}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            {visibleChannels.map((channel) => (
              <ChannelPill key={channel} channel={channel} size="xs" />
            ))}
            {channelOverflow > 0 && (
              <span className="text-xs text-muted-foreground">
                +{channelOverflow} more
              </span>
            )}
            {externalChannels.length === 0 && (
              <span className="text-xs text-muted-foreground">
                — only on web
              </span>
            )}
          </div>
        </div>

        {/* Activity stats */}
        <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs sm:flex">
          <ActivityStat count={agent.runCountToday ?? 0} />
          <LastActiveLabel timestamp={agent.lastActiveAt ?? null} />
        </div>

        {/* Status dot — wrapped in a tooltip showing the model name */}
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <span
                {...props}
                tabIndex={0}
                className="shrink-0 outline-none"
                aria-label={`Status: ${agent.status}`}
              >
                <StatusIndicator status={agent.status} />
              </span>
            )}
          />
          <TooltipContent side="left">
            <span className="flex flex-col gap-0.5">
              <span className="capitalize">{agent.status}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {humanizeModel(agent.model)}
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </Link>
    </li>
  );
}

/* ── Activity stat (today's run count) ───────────────────── */

function ActivityStat({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-muted-foreground">No activity today</span>;
  }
  return (
    <span className="text-foreground tabular-nums">
      {count} {count === 1 ? "conversation" : "conversations"} today
    </span>
  );
}

/* ── Last active label (relative time from timestamp) ────── */

function LastActiveLabel({ timestamp }: { timestamp: number | null }) {
  if (!timestamp) {
    return <span className="text-muted-foreground">Not started</span>;
  }
  return (
    <span className="text-muted-foreground tabular-nums">
      {formatTimeAgo(timestamp)}
    </span>
  );
}

/* ── Empty state ─────────────────────────────────────────── */

function AgentsEmptyState() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center justify-center px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-32 text-center">
        <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground md:text-4xl">
          No agents yet.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          Create your first agent to start working in Slack, WhatsApp,
          Telegram, or email.
        </p>
        <Button
          className="mt-8"
          render={<Link href={"/agents/new" as Route} />}
        >
          Create an agent
        </Button>
      </div>
    </div>
  );
}

/* ── Loading skeleton ────────────────────────────────────── */

function AgentsLoadingSkeleton() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12 xl:px-12 xl:py-16">
        <div className="flex justify-end">
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="mt-6 h-7 w-48" />
        <div className="mt-6 max-w-2xl space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-3/4" />
        </div>
        <div className="mt-8">
          <Skeleton className="h-3 w-20" />
          <div className="mt-2 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>
        <div className="mt-16 space-y-1">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="hidden flex-col items-end gap-1 sm:flex">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="size-2 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatTimeAgo(ms: number): string {
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function humanizeModel(model: string): string {
  // "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"
  // "moonshotai/kimi-k2.5" → "kimi-k2.5"
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
}
