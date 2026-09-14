"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { sileo } from "sileo";
import { UploadSimple } from "@phosphor-icons/react";

import { useAgent } from "@/hooks/use-agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/unicode-spinner";
import { FileTree, type FileSelection } from "@/components/files/file-tree";
import { FileViewer } from "@/components/files/file-viewer";

/**
 * Files — the agent's file explorer.
 *
 * Left rail lists Knowledge (memory) files and the Workspace tree.
 * Right pane shows the selected file with edit/download/delete.
 *
 * Uploads drop into /home/daytona/agent/knowledge/ (the designated
 * upload folder). After upload, the workspace tree auto-refreshes.
 */
export default function FilesPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: agent, isLoading } = useAgent(agentId);

  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isLoading || !agent) {
    return (
      <div className="flex h-full">
        <div className="w-72 border-r border-border/60 p-3">
          <Skeleton className="mb-3 h-4 w-24" />
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  const selectedPath = selection
    ? selection.kind === "memory"
      ? selection.file.path
      : selection.file.path
    : null;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("path", "/home/daytona/agent/knowledge");
      const res = await fetch(`/api/agents/${agentId}/file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      sileo.success({ title: "Uploaded", description: file.name });
      setWorkspaceRefreshKey((k) => k + 1);
    } catch (err) {
      sileo.error({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <h1 className="font-serif text-lg font-light leading-snug tracking-tight text-foreground">
            Files
          </h1>
          <p className="text-xs text-muted-foreground">
            Everything {agent.name} knows and works with.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Spinner context="button" className="text-[10px]" />
            ) : (
              <UploadSimple className="size-3.5" />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tree rail */}
        <div
          key={`tree-${workspaceRefreshKey}`}
          className="w-72 shrink-0 border-r border-border/60"
        >
          <FileTree
            agentId={agentId}
            selectedPath={selectedPath}
            onSelect={setSelection}
            memoryRefreshKey={memoryRefreshKey}
          />
        </div>

        {/* Viewer */}
        <div className="min-h-0 min-w-0 flex-1">
          <FileViewer
            agentId={agentId}
            selection={selection}
            onMemorySaved={() => setMemoryRefreshKey((k) => k + 1)}
            onClose={() => setSelection(null)}
          />
        </div>
      </div>
    </div>
  );
}
