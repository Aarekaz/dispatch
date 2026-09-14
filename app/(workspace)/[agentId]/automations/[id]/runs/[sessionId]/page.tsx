"use client";

import { use } from "react";

import { AutomationRunDetailView } from "@/components/views/automation-run-detail-view";

/**
 * Workspace-scoped automation run detail. Renders the same
 * `AutomationRunDetailView` as the legacy route, but inside the
 * workspace shell so users keep their dock, sandbox pill, and
 * agent switcher while reading a specific run.
 *
 * Reachable via the "run" list on the automation detail page
 * (`/[agentId]/automations/[id]`), which now builds links with
 * the agentId prefix.
 */
export default function WorkspaceAutomationRunPage({
  params,
}: {
  params: Promise<{ agentId: string; id: string; sessionId: string }>;
}) {
  const { id, sessionId } = use(params);
  return (
    <AutomationRunDetailView automationId={id} sessionId={sessionId} />
  );
}
