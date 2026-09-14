/* ── Core Types ────────────────────────────── */

export type AgentStatus = "active" | "idle" | "draft" | "attention" | "error";

export type AgentType = {
  id: string;
  label: string;
  icon: string;
};

export type AgentPack = {
  id: string;
  name: string;
  vertical: string;
  description: string;
  defaultChannels: string[];
  suggestedName?: string;
  brief?: string;
};

export type Agent = {
  id: string;
  name: string;
  slug: string;
  pack: string;
  vertical: string;
  status: AgentStatus;
  model: string;
  persona?: string;
  toolPermissions?: string;
  /**
   * Composio toolkit slugs enabled for this agent (e.g. ["gmail","linear"]).
   * Always present — the Convex projection defaults to `[]` for rows
   * that predate the field.
   */
  composioToolkits?: string[];
  /** Real timestamp of most recent run, null if the agent has never run. */
  lastActiveAt?: number | null;
  /** Number of runs since start of today (UTC). */
  runCountToday?: number;
  channels: string[];
  summary: string;
  emoji?: string;
  tasksRunning?: number;
  email?: string;
  endpoint?: string;
};

export type AgentTool = {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  connected: boolean;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type AgentTask = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  platform?: string;
  createdAt: string;
};

export type AgentFile = {
  id: string;
  name: string;
  type: string;
  size: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

export type OnboardingStep = {
  id: string;
  label: string;
  completed: boolean;
};

export type Session = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

export type MemoryFile = {
  id: string;
  name: string;
  path: string;
  type: "profile" | "playbook" | "contacts" | "working-note";
  preview: string;
  updatedAt: string;
};

export type WorkspaceFile = {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  size?: string;
};

// CronJob type removed — crons are now agentAutomations.
// See convex/agentAutomations.ts for the new schema.

export type Approval = {
  id: string;
  action: string;
  detail: string;
  tool: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type AgentRun = {
  id: string;
  trigger: "chat" | "cron" | "webhook" | "manual" | "automation";
  channel?: string;
  sessionId?: string;
  sessionTitle?: string;
  // Automation attribution — set when trigger === "automation"
  automationId?: string;
  automationName?: string;
  status: "running" | "completed" | "failed";
  summary: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  credits: number;
  startedAt: string;
  duration: string;
  // ── Failure diagnostics ──────────────────────────────────
  //
  // Populated only when `status === "failed"`. Mirrors the Convex
  // `agentRuns` schema; see `lib/chat/errors.ts` for the classifier
  // that fills these. Treat as optional in all consumers — pre-
  // existing failed runs from before the classifier shipped will
  // have all three as undefined.
  errorCategory?: string;
  errorDetail?: string;
  correlationId?: string;
};

export type ToolPermission = {
  tool: string;
  level: "allow" | "ask" | "deny";
};

export type SandboxStatus = {
  state: "running" | "stopped" | "starting";
  uptime?: string;
  idleTimeout: number;
  lastStarted?: string;
};
