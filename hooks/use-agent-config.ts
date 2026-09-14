"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MODELS } from "@/lib/models";
import type {
  AgentTool,
  AgentSkill,
  AgentFile,
  Approval,
  AgentRun,
  ToolPermission,
  SandboxStatus,
} from "@/lib/types";

type AsyncData<T> = { data: T; isLoading: boolean; error: string | null };

/* ── Convex-backed hooks (reactive) ─────────── */

function useAgentRuns(agentId: string): AsyncData<AgentRun[]> {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(
    api.runs.list,
    isAuthenticated ? { agentId: agentId as Id<"agents"> } : "skip",
  );

  if (result === undefined) {
    return { data: [], isLoading: true, error: null };
  }

  const mapped: AgentRun[] = result.map((r) => ({
    id: r._id,
    trigger: r.trigger as AgentRun["trigger"],
    channel: r.channel ?? undefined,
    sessionId: r.sessionId ?? undefined,
    sessionTitle: r.sessionTitle ?? undefined,
    status: r.status as AgentRun["status"],
    summary: r.summary ?? "",
    model: r.model ?? "",
    tokensIn: r.tokensIn ?? 0,
    tokensOut: r.tokensOut ?? 0,
    credits: r.credits ?? 0,
    startedAt: new Date(r.startedAt).toLocaleString(),
    duration: r.duration ?? "",
    errorCategory: r.errorCategory ?? undefined,
    errorDetail: r.errorDetail ?? undefined,
    correlationId: r.correlationId ?? undefined,
  }));

  return { data: mapped, isLoading: false, error: null };
}

// useAgentCrons removed — crons are now automations. See
// `hooks/use-automations.ts` and `/automations` page.

// useAgentPersona was removed — persona is now read from the Convex
// `agents.persona` field via the reactive `useAgent()` hook, not from
// the sandbox FUSE filesystem. This eliminated a ~450ms round-trip
// per page load. See commit e3392c7.

/* ── Static defaults (Phase 4 deferred) ─────── */

const defaultPermissions: ToolPermission[] = [
  { tool: "bash", level: "ask" },
  { tool: "read", level: "allow" },
  { tool: "write", level: "allow" },
  { tool: "edit", level: "allow" },
  { tool: "browser", level: "ask" },
  { tool: "email", level: "ask" },
  { tool: "calendar", level: "ask" },
  { tool: "message", level: "ask" },
  { tool: "computer", level: "ask" },
  { tool: "memory", level: "allow" },
  { tool: "web_fetch", level: "allow" },
  { tool: "web_search", level: "allow" },
];

const defaultSandbox: SandboxStatus = {
  state: "running",
  idleTimeout: 15,
};

/* ── Public hooks ───────────────────────────── */

/**
 * Agent tools, skills, and files.
 * Returns empty arrays — tools/skills will come from OpenCode config in a future phase.
 */
export function useAgentTools(_agentId: string): {
  tools: AsyncData<AgentTool[]>;
  skills: AsyncData<AgentSkill[]>;
  files: AsyncData<AgentFile[]>;
} {
  void _agentId;
  return {
    tools: { data: [], isLoading: false, error: null },
    skills: { data: [], isLoading: false, error: null },
    files: { data: [], isLoading: false, error: null },
  };
}

/**
 * Agent management data — facade hook composing real + deferred sources.
 * Same return shape as before so components need no changes.
 */
export function useAgentManagement(agentId: string) {
  const runs = useAgentRuns(agentId);
  return {
    // REAL — Convex reactive
    runs,
    // DEFERRED — Phase 4
    tasks: { data: [] as AgentFile[], isLoading: false, error: null },
    approvals: { data: [] as Approval[], isLoading: false, error: null },
    permissions: {
      data: defaultPermissions,
      isLoading: false,
      error: null,
    } as AsyncData<ToolPermission[]>,
    sandbox: {
      data: defaultSandbox,
      isLoading: false,
      error: null,
    } as AsyncData<SandboxStatus>,
  };
}

/**
 * Available LLM models — reads from centralized lib/models.ts.
 */
export function useModels() {
  return {
    data: MODELS,
    isLoading: false,
    error: null,
  };
}
