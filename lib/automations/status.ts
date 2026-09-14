/**
 * Shared automation run status types and helpers.
 * Used by both the automation detail view (run list) and the
 * run detail view (single run page).
 */

export type RunStatus = "pending" | "running" | "completed" | "failed";

/**
 * Derive the display status from session data.
 * Uses `automationStatus` when available, with a timestamp-based
 * fallback for sessions created before the field existed.
 */
export function deriveRunStatus(session: {
  automationStatus?: string | null;
  createdAt: number;
  updatedAt: number;
}): RunStatus {
  if (session.automationStatus) return session.automationStatus as RunStatus;
  // Fallback: 10-minute window for old sessions without explicit status
  const isRecent = Date.now() - session.createdAt < 600_000;
  const hasResult = session.updatedAt > session.createdAt + 1000;
  if (isRecent && !hasResult) return "running";
  return "completed";
}

export const STATUS_CONFIG: Record<
  RunStatus,
  { label: string; color: string }
> = {
  pending: { label: "Preparing", color: "text-muted-foreground" },
  running: { label: "Running", color: "text-foreground" },
  completed: { label: "Completed", color: "text-foreground" },
  failed: { label: "Failed", color: "text-destructive" },
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
};

export function getTriggerLabel(trigger: string | undefined): string {
  if (!trigger) return "Manual";
  if (TRIGGER_LABELS[trigger]) return TRIGGER_LABELS[trigger];
  if (trigger.startsWith("trigger:")) return "Trigger";
  return trigger;
}
