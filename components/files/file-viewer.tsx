"use client";

import { useCallback, useState } from "react";
import { sileo } from "sileo";
import { Check, DownloadSimple, FileText, Pencil, Play, Trash, X } from "@phosphor-icons/react";

import type { MemoryFile, WorkspaceFile } from "@/lib/types";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useOnSandboxWake } from "@/hooks/use-sandbox-wake";
import { useSandbox } from "@/hooks/use-sandbox";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/unicode-spinner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getFileLabel,
  isEditableAsText,
} from "@/lib/files/file-icon";

export type FileSelection =
  | { kind: "memory"; file: MemoryFile }
  | { kind: "workspace"; file: WorkspaceFile };

/**
 * File viewer — renders the currently selected file.
 *
 *   • empty → calm placeholder
 *   • memory → read-only preview with Edit button (switches to textarea)
 *   • workspace → read-only content with Download button
 *
 * Kept deliberately minimal: one file at a time, monospace rendering for
 * code/text (line numbers included), proper error and loading states.
 */
export function FileViewer({
  agentId,
  selection,
  onMemorySaved,
  onClose,
}: {
  agentId: string;
  selection: FileSelection | null;
  onMemorySaved?: () => void;
  onClose?: () => void;
}) {
  if (!selection) {
    return <EmptyPane />;
  }

  if (selection.kind === "memory") {
    return (
      <MemoryViewer
        agentId={agentId}
        file={selection.file}
        onSaved={onMemorySaved}
        onClose={onClose}
      />
    );
  }

  return (
    <WorkspaceViewer
      agentId={agentId}
      file={selection.file}
      onClose={onClose}
    />
  );
}

/* ─────────────────────────────────────────────
   Empty state
   ───────────────────────────────────────────── */

function EmptyPane() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <p className="text-sm text-muted-foreground">No file selected</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Pick a file from the left to preview or edit.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Memory file viewer — with inline editor
   ───────────────────────────────────────────── */

function MemoryViewer({
  agentId,
  file,
  onSaved,
  onClose,
}: {
  agentId: string;
  file: MemoryFile;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch full file content when the selection changes
  const fetchContent = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${agentId}/memory?file=${encodeURIComponent(file.path)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setContent(data.content ?? "");
      setDraft(data.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load file");
      setContent("");
    }
  }, [agentId, file.path]);

  useMountEffect(() => {
    void fetchContent();
  });

  // Re-fetch whenever the selected file path changes
  const [lastPath, setLastPath] = useState(file.path);
  if (lastPath !== file.path) {
    setLastPath(file.path);
    setContent(null);
    setEditing(false);
    void fetchContent();
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/memory`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setContent(draft);
      setEditing(false);
      sileo.success({ title: "Saved" });
      onSaved?.();
    } catch (err) {
      sileo.error({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(content ?? "");
    setEditing(false);
  }

  const icon = <FileBadge name={file.name} label={getFileLabel(file.name)} />;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {file.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {file.path}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving || draft === content}>
                {saving ? (
                  <Spinner context="button" className="text-[10px]" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={content === null}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label="Close file"
              className="size-7"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {content === null ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner
              context="loading"
              className="text-xs text-muted-foreground"
            />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : editing ? (
          <div className="p-4">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[400px] resize-none font-mono text-[12px] leading-relaxed"
              autoFocus
            />
          </div>
        ) : (
          <CodeBlock content={content} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Workspace file viewer — read-only
   ───────────────────────────────────────────── */

function WorkspaceViewer({
  agentId,
  file,
  onClose,
}: {
  agentId: string;
  file: WorkspaceFile;
  onClose?: () => void;
}) {
  const sandbox = useSandbox(agentId);
  const sandboxState = sandbox.data?.state;
  const isRunning = sandboxState === "running" || sandboxState === "started";
  const isWaking =
    sandbox.isMutating ||
    sandboxState === "starting" ||
    sandboxState === "stopping";

  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = isEditableAsText(file.name);

  const fetchContent = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${agentId}/file?path=${encodeURIComponent(file.path)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const text = data.content ?? "";
      setContent(text);
      setDraft(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load file");
      setContent("");
    }
  }, [agentId, file.path]);

  useMountEffect(() => {
    if (isRunning) void fetchContent();
  });

  // Re-fetch when selection switches to a different file
  const [lastPath, setLastPath] = useState(file.path);
  if (lastPath !== file.path) {
    setLastPath(file.path);
    setContent(null);
    setEditing(false);
    if (isRunning) void fetchContent();
  }

  // Auto-load the pending file once the sandbox finishes waking, so
  // the user doesn't have to click it again. The hook fires only on
  // the inactive → running transition; the `content === null` guard
  // prevents re-fetching if the user already has the file loaded.
  useOnSandboxWake(sandboxState, () => {
    if (content === null) void fetchContent();
  });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setContent(draft);
      setEditing(false);
      sileo.success({ title: "Saved" });
    } catch (err) {
      sileo.error({
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(content ?? "");
    setEditing(false);
  }

  function download() {
    if (content === null) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove() {
    if (!confirm(`Delete ${file.name}? This can't be undone.`)) return;
    try {
      const res = await fetch(
        `/api/agents/${agentId}/file?path=${encodeURIComponent(file.path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      sileo.success({ title: "Deleted" });
      onClose?.();
    } catch (err) {
      sileo.error({
        title: "Couldn't delete",
        description: err instanceof Error ? err.message : "Try again",
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileBadge name={file.name} label={getFileLabel(file.name)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {file.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {file.path}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={saving}
              >
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || draft === content}
              >
                {saving ? (
                  <Spinner context="button" className="text-[10px]" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Save
              </Button>
            </>
          ) : (
            <>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                  disabled={content === null}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={download}
                disabled={content === null}
              >
                <DownloadSimple className="size-3.5" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={remove}
                aria-label="Delete file"
                className="size-7 text-muted-foreground hover:text-destructive"
              >
                <Trash className="size-3.5" />
              </Button>
            </>
          )}
          {onClose && !editing && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              aria-label="Close file"
              className="size-7"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {content === null ? (
          !isRunning ? (
            <StoppedViewerState
              fileName={file.name}
              onWake={() => void sandbox.restart()}
              waking={isWaking}
            />
          ) : (
            <div className="flex h-32 items-center justify-center">
              <Spinner
                context="loading"
                className="text-xs text-muted-foreground"
              />
            </div>
          )
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : !editable ? (
          <BinaryPlaceholder name={file.name} />
        ) : editing ? (
          <div className="p-4">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[400px] resize-none font-mono text-[12px] leading-relaxed"
              autoFocus
            />
          </div>
        ) : (
          <CodeBlock content={content} />
        )}
      </div>
    </div>
  );
}

function BinaryPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <p className="text-sm text-muted-foreground">
          {getFileLabel(name)} file — preview not available.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Download to view it.
        </p>
      </div>
    </div>
  );
}

function StoppedViewerState({
  fileName,
  onWake,
  waking,
}: {
  fileName: string;
  onWake: () => void;
  waking: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <p className="text-sm text-muted-foreground">
          Sandbox is stopped — {fileName} isn&apos;t readable right now.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          The file tree is cached in our database, but file contents live only
          on the sandbox.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onWake}
          disabled={waking}
          className="mt-4"
        >
          {waking ? (
            <Spinner context="button" className="text-[10px]" />
          ) : (
            <Play className="size-3.5" />
          )}
          {waking ? "Waking…" : "Wake sandbox"}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Shared atoms
   ───────────────────────────────────────────── */

function FileBadge({ label }: { name: string; label: string }) {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]"
      title={label}
    >
      <FileText className="size-4 text-muted-foreground" />
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <pre className="p-5 font-mono text-[12px] leading-relaxed text-foreground">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            className={cn(
              "mr-4 inline-block w-10 select-none text-right text-muted-foreground/40 tabular-nums",
            )}
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {line || " "}
          </span>
        </div>
      ))}
    </pre>
  );
}
