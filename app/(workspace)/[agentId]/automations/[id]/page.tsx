"use client";

import { use } from "react";
import type { Route } from "next";

import { AutomationDetailView } from "@/components/views/automation-detail-view";

/**
 * Workspace-scoped automation detail page. Renders the same
 * `AutomationDetailView` as the dashboard route, but mounted inside
 * the workspace layout so the user keeps their agent switcher,
 * sandbox pill, and sidebar. The `backHref` prop redirects both the
 * back button and the post-delete navigation to the agent-scoped
 * automations list.
 */
export default function WorkspaceAutomationDetailPage({
  params,
}: {
  params: Promise<{ agentId: string; id: string }>;
}) {
  const { agentId, id } = use(params);
  return (
    <AutomationDetailView
      automationId={id}
      backHref={`/${agentId}/automations` as Route}
      backLabel="Automations"
    />
  );
}
