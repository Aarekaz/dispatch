"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";

import { AgentIsland } from "./agent-island";
import { ArtifactsDrawer } from "./artifacts-drawer";
import { ArtifactsPill } from "./artifacts-pill";
import { ArtifactsProvider } from "./artifacts-context";
import { SandboxPill } from "./sandbox-pill";
import { UserIsland } from "./user-island";
import { Dock } from "./dock";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { agentId } = useParams<{ agentId: string }>();

  return (
    <ArtifactsProvider>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
        <AgentIsland />
        <ArtifactsPill />
        <SandboxPill />
        <UserIsland />

        {/* Content area — padded to clear floating islands */}
        <main className="min-h-0 flex-1 overflow-hidden pt-14 pb-16">
          {children}
        </main>

        {/* Artifacts drawer — floats above content when open. Sits
            above the dock (z-40) so the dock-item labels still peek
            through if the drawer is narrower than the viewport edge. */}
        <ArtifactsDrawer agentId={agentId} />

        <Dock />
      </div>
    </ArtifactsProvider>
  );
}
