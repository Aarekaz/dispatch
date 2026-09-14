"use client";

import {
  ArrowSquareOut,
  FileText,
  Globe,
  Monitor,
  X,
} from "@phosphor-icons/react";

import { useAgentContext } from "@/components/agent-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  useArtifacts,
  type Artifact,
} from "@/components/workspace/artifacts-context";

/**
 * Artifacts drawer — renders the list of things the agent has
 * announced via `announce_artifact`. Slides in from the right.
 *
 * Click semantics (kept minimal on purpose):
 *
 *   webapp / page  → opens the Daytona preview URL in a new tab
 *                    (agent-side, we don't have a port→URL mapping
 *                    in this component; we compute it from the
 *                    `openPreviewPath` helper that the shell passes
 *                    down via context)
 *   file / report  → opens in the existing file viewer via
 *                    `useAgentContext().onOpenFile(path)`, same
 *                    rail that the Write/Edit/Read file tool cards
 *                    use. No new plumbing needed.
 *
 * No inline iframe in v1. When someone asks for "let me see it
 * without leaving," we add a viewer pane or a live-preview mode
 * here. For now: the drawer is the TABLE OF CONTENTS, the viewer
 * is wherever the target content lives.
 */
export function ArtifactsDrawer({ agentId }: { agentId: string }) {
  const { artifacts, isOpen, close, selectedId, select } = useArtifacts();
  const { onOpenFile } = useAgentContext();

  if (!isOpen) return null;

  async function openArtifact(artifact: Artifact) {
    select(artifact.id);
    if (
      (artifact.kind === "webapp" || artifact.kind === "page") &&
      artifact.port != null
    ) {
      // Ask our preview API for the Daytona public URL for this port.
      // Opens in a new tab — the drawer stays visible for the user
      // to keep their list.
      try {
        const res = await fetch(
          `/api/agents/${agentId}/preview?port=${artifact.port}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { url?: string };
          if (data.url) {
            window.open(data.url, "_blank", "noopener,noreferrer");
            return;
          }
        }
      } catch {
        /* fall through */
      }
      return;
    }
    if (
      (artifact.kind === "file" || artifact.kind === "report") &&
      artifact.path &&
      onOpenFile
    ) {
      onOpenFile(artifact.path);
      return;
    }
  }

  return (
    <aside
      className="fixed right-0 top-14 bottom-16 z-40 flex w-[360px] flex-col border-l border-border/60 bg-background shadow-lg"
      aria-label="Artifacts"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight text-foreground">
            Artifacts
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {artifacts.length === 0
              ? "Nothing published yet."
              : `${artifacts.length} ${artifacts.length === 1 ? "item" : "items"} this session`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          aria-label="Close artifacts drawer"
        >
          <X className="size-3.5" />
        </Button>
      </header>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {artifacts.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            When the agent creates something you should see — a running
            app, a saved file, a report — it&apos;ll show up here.
          </p>
        ) : (
          <ul className="space-y-1">
            {[...artifacts]
              .sort((a, b) => b.announcedAt - a.announcedAt)
              .map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  selected={artifact.id === selectedId}
                  onOpen={() => openArtifact(artifact)}
                />
              ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ArtifactRow({
  artifact,
  selected,
  onOpen,
}: {
  artifact: Artifact;
  selected: boolean;
  onOpen: () => void;
}) {
  const { icon: Icon, iconColor, kindLabel } = iconMetaForKind(artifact.kind);
  const subtitle =
    artifact.description ||
    (artifact.port != null
      ? `${kindLabel} · port ${artifact.port}`
      : artifact.path
        ? `${kindLabel} · ${artifact.path.split("/").pop() ?? artifact.path}`
        : kindLabel);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            iconColor,
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {artifact.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <ArrowSquareOut className="mt-1 size-3 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

function iconMetaForKind(kind: Artifact["kind"]): {
  icon: React.ElementType;
  iconColor: string;
  kindLabel: string;
} {
  switch (kind) {
    case "webapp":
      return {
        icon: Monitor,
        iconColor: "bg-info-subtle text-info",
        kindLabel: "Running app",
      };
    case "page":
      return {
        icon: Globe,
        iconColor: "bg-info-subtle text-info",
        kindLabel: "Page",
      };
    case "file":
      return {
        icon: FileText,
        iconColor: "bg-muted text-muted-foreground",
        kindLabel: "File",
      };
    case "report":
      return {
        icon: FileText,
        iconColor: "bg-success-subtle text-success",
        kindLabel: "Report",
      };
  }
}
