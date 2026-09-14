"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type SessionItem = {
  id: string;
  title: string;
  /** Formatted for display (e.g., "Yesterday"). */
  updatedAt: string;
  /** Raw timestamp for grouping / sorting. */
  updatedAtMs: number;
  createdAtMs: number;
  /** True when the session was created by an automation trigger. */
  isAutomation: boolean;
  /** Trigger type when automation ("manual", "schedule", "trigger:..."). */
  automationTrigger?: string;
};

/** Convex Ids are 32-char lowercase base32. Anything else (e.g. demo routes
 *  like "chat-example") would throw an ArgumentValidationError on the wire. */
const CONVEX_ID_RE = /^[a-z0-9]{32}$/;

/**
 * Shared reactive hook for agent sessions.
 * All components subscribe to the same Convex query — zero duplicate fetches.
 */
export function useAgentSessions(agentId: string) {
  const sessions = useQuery(
    api.sessions.list,
    CONVEX_ID_RE.test(agentId)
      ? { agentId: agentId as Id<"agents"> }
      : "skip",
  );

  return {
    data:
      sessions?.map(
        (s): SessionItem => ({
          id: s.sessionExternalId,
          title: s.title || `Session ${s.sessionExternalId.slice(-8)}`,
          updatedAt: new Date(s.updatedAt).toLocaleDateString(),
          updatedAtMs: s.updatedAt,
          createdAtMs: s.createdAt,
          isAutomation: !!s.automationId,
          automationTrigger: s.automationTrigger,
        }),
      ) ?? [],
    isLoading: sessions === undefined,
  };
}
