"use client";

import { useState, useTransition } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { CaretDown, Plus } from "@phosphor-icons/react";
import { sileo } from "sileo";
import { useAgents, useAgent } from "@/hooks/use-agents";
import { useAgentSessions } from "@/hooks/use-sessions";
import { AgentAvatar } from "@/components/agent-avatar";
import { DispatchMark } from "@/components/brand/dispatch-mark";
import { BetaTag } from "@/components/workspace/beta-tag";
import { Spinner, StatusIndicator } from "@/components/ui/unicode-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Map URL segments to readable breadcrumb labels. */
const SECTION_LABELS: Record<string, string> = {
  activity: "Activity",
  connect: "Connect",
  automations: "Automations",
  files: "Files",
  settings: "Settings",
};

export function AgentIsland() {
  const { agentId } = useParams<{ agentId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: currentAgent, isLoading } = useAgent(agentId);
  const { data: sessions } = useAgentSessions(agentId);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function switchAgent(nextAgentId: string) {
    if (nextAgentId === agentId) return;
    setSwitchingTo(nextAgentId);
    startTransition(() => {
      router.push(`/${nextAgentId}/home` as Route);
    });
  }

  // Clear switching indicator once we land on the new agent
  if (switchingTo && agentId === switchingTo) {
    setSwitchingTo(null);
  }

  // Derive breadcrumb — either a section name or an active session title.
  const pathAfterAgent = pathname.replace(`/${agentId}`, "");
  const firstSegment = pathAfterAgent.split("/").filter(Boolean)[0];
  const activeSessionId = searchParams.get("session");

  let breadcrumb: string | null = null;
  if (firstSegment === "home" && activeSessionId) {
    // On home with a session loaded — show the session title
    const session = sessions.find((s) => s.id === activeSessionId);
    breadcrumb = session?.title ?? null;
  } else if (firstSegment && firstSegment !== "home") {
    // Any other section — show its label
    breadcrumb = SECTION_LABELS[firstSegment] ?? null;
  }

  return (
    <div className="fixed left-4 top-4 z-50 flex h-9 items-center gap-2 rounded-full border border-border/60 bg-background px-3 shadow-sm">
      {/* Logo + beta tag — visually grouped (no separator between
          them, then a "/" separator before the agent switcher). */}
      <Link href={`/${agentId}/home` as Route} aria-label="Home">
        <DispatchMark className="size-5 text-foreground" />
      </Link>
      <BetaTag />

      <span className="text-sm text-border/80">/</span>

      {/* Agent switcher */}
      {isLoading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.04]">
            {currentAgent && (
              <>
                <StatusIndicator status={currentAgent.status} />
                <span className="max-w-[140px] truncate">
                  {currentAgent.name}
                </span>
              </>
            )}
            <CaretDown className="size-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {agents.map((agent) => {
              const isSwitching = switchingTo === agent.id;
              const isActive = agentId === agent.id;
              return (
                <DropdownMenuItem
                  key={agent.id}
                  onSelect={(e) => {
                    if (isSwitching || isActive) {
                      e.preventDefault();
                      return;
                    }
                    switchAgent(agent.id);
                    // Keep the menu open while we switch so the user sees the spinner
                    e.preventDefault();
                  }}
                  disabled={isSwitching}
                  className="flex items-center gap-2.5"
                >
                  <AgentAvatar name={agent.name} size="xs" />
                  <span className="flex-1 truncate text-sm">{agent.name}</span>
                  {isSwitching ? (
                    <Spinner
                      context="button"
                      className="text-[10px] text-muted-foreground"
                    />
                  ) : (
                    <StatusIndicator status={agent.status} />
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                sileo.info({
                  title: "Coming soon",
                  description: "Agent creation isn't available yet.",
                })
              }
              className="flex items-center gap-2.5 text-muted-foreground"
            >
              <Plus className="size-4" />
              <span className="text-sm">New agent</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Breadcrumb — section name or active chat session title */}
      {breadcrumb && (
        <>
          <span className="text-sm text-border/80">/</span>
          <span className="max-w-[200px] truncate text-sm text-muted-foreground">
            {breadcrumb}
          </span>
        </>
      )}
    </div>
  );
}
