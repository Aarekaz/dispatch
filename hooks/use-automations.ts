"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useAutomations() {
  const data = useQuery(api.agentAutomations.listAll);

  return {
    automations: data ?? [],
    isLoading: data === undefined,
  };
}

export function useAutomation(id: string) {
  const automation = useQuery(api.agentAutomations.get, {
    id: id as Id<"agentAutomations">,
  });

  // Sessions triggered by this automation (replaces the old "runs" concept)
  const sessions = useQuery(api.sessions.listByAutomation, {
    automationId: id as Id<"agentAutomations">,
    limit: 10,
  });

  return {
    automation: automation ?? null,
    sessions: sessions ?? [],
    isLoading: automation === undefined,
  };
}

/**
 * Single automation run (session + messages + context).
 * Powers the run detail page.
 */
export function useAutomationRun(sessionId: string) {
  const data = useQuery(api.sessions.getAutomationRun, {
    sessionId: sessionId as Id<"agentSessions">,
  });

  return {
    data: data ?? null,
    isLoading: data === undefined,
  };
}
