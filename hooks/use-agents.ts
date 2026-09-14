"use client";

import { useQuery, useConvexAuth } from "convex/react";
import type { Agent } from "@/lib/types";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Fetches the list of agents for the current user.
 */
export function useAgents(): {
  data: Agent[];
  isLoading: boolean;
  error: string | null;
} {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(api.agents.list, isAuthenticated ? {} : "skip");

  if (result === undefined) {
    return { data: [], isLoading: true, error: null };
  }

  return { data: result as Agent[], isLoading: false, error: null };
}

/**
 * Fetches a single agent by ID.
 */
export function useAgent(id: string): {
  data: Agent | null;
  isLoading: boolean;
  error: string | null;
} {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(
    api.agents.get,
    isAuthenticated ? { id: id as Id<"agents"> } : "skip",
  );

  if (result === undefined) {
    return { data: null, isLoading: true, error: null };
  }

  return { data: result as Agent | null, isLoading: false, error: null };
}
