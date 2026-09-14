"use client";

import { useEffect, useRef, useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { useSound } from "@web-kits/audio/react";
import { useAgentContext } from "@/components/agent-context";
import { useArtifacts } from "@/components/workspace/artifacts-context";
import { announceArtifactTitle } from "@/lib/tools/normalize";
import { ARTIFACT_ANNOUNCED } from "@/lib/sounds";
import {
  ArrowSquareOut,
  Check,
  File,
  FileCode,
  FileText,
  Globe,
  MagnifyingGlass,
  Monitor,
  Sparkle,
  Terminal,
} from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/unicode-spinner";
import { cn } from "@/lib/utils";

/* ── Shared helpers ────────────────────────── */

function StatusIcon({ status }: { status: string }) {
  if (status === "running") {
    return <Spinner context="tool" className="shrink-0 text-sm text-muted-foreground" />;
  }
  return <Check className="size-4 shrink-0 text-success" />;
}

function ToolCard({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  status,
  children,
}: {
  icon: React.ElementType;
  iconColor?: string;
  title: string;
  subtitle?: string;
  status: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className={cn("flex size-8 items-center justify-center rounded-md", iconColor ?? "bg-muted text-muted-foreground")}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <StatusIcon status={status} />
      </div>
      {children}
    </div>
  );
}

/* ── Terminal ───────────────────────────────── */

export const TerminalToolUI = makeAssistantToolUI({
  toolName: "Terminal",
  render: ({ args, result, status }) => {
    const command = typeof args?.command === "string" ? args.command : "";
    const output = typeof result === "string" ? result : "";
    const truncatedOutput = output.length > 300 ? output.slice(0, 300) + "\n..." : output;

    return (
      <ToolCard
        icon={Terminal}
        iconColor="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        title={command || "Terminal"}
        status={status?.type ?? "complete"}
      >
        {truncatedOutput && status?.type === "complete" && (
          <div className="border-t border-border bg-muted/30 px-3.5 py-2">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
              {truncatedOutput}
            </pre>
          </div>
        )}
      </ToolCard>
    );
  },
});

/* ── Web Search / Fetch ────────────────────── */

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: "Web Search",
  render: ({ args, status }) => {
    const url = typeof args?.url === "string" ? args.url : "";
    const query = typeof args?.query === "string" ? args.query : "";
    let hostname = "Searching...";
    if (url) {
      try { hostname = new URL(url).hostname; } catch { hostname = url; }
    }
    const display = query || hostname;

    return (
      <ToolCard
        icon={Globe}
        iconColor="bg-info-subtle text-info"
        title={display}
        subtitle={url || undefined}
        status={status?.type ?? "complete"}
      />
    );
  },
});

/* ── Tool Call (generic webfetch/call fallback) */

export const ToolCallUI = makeAssistantToolUI({
  toolName: "Tool Call",
  render: ({ args, status }) => {
    const url = typeof args?.url === "string" ? args.url : "";
    const display = url ? new URL(url).hostname : "Running tool...";

    return (
      <ToolCard
        icon={Globe}
        iconColor="bg-info-subtle text-info"
        title={display}
        subtitle={url || undefined}
        status={status?.type ?? "complete"}
      />
    );
  },
});

/* ── File operations ───────────────────────── */

const EXT_META: Record<string, { icon: typeof File; color: string; label: string }> = {
  html: { icon: FileCode, color: "bg-warning-subtle text-warning", label: "HTML" },
  css: { icon: FileCode, color: "bg-info-subtle text-info", label: "CSS" },
  js: { icon: FileCode, color: "bg-warning-subtle text-warning", label: "JavaScript" },
  ts: { icon: FileCode, color: "bg-info-subtle text-info", label: "TypeScript" },
  jsx: { icon: FileCode, color: "bg-warning-subtle text-warning", label: "React" },
  tsx: { icon: FileCode, color: "bg-info-subtle text-info", label: "React TS" },
  py: { icon: FileCode, color: "bg-success-subtle text-success", label: "Python" },
  json: { icon: FileCode, color: "bg-warning-subtle text-warning", label: "JSON" },
  md: { icon: FileText, color: "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400", label: "Markdown" },
  txt: { icon: FileText, color: "bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500", label: "Text" },
  sh: { icon: FileCode, color: "bg-success-subtle text-success", label: "Shell" },
};

function fileToolRender(action: string) {
  return function FileToolRender({
    args,
    status,
  }: {
    args: Record<string, unknown>;
    status: { type?: string } | undefined;
  }) {
    const { onOpenFile } = useAgentContext();
    const filePath = (args?.file_path ?? args?.path ?? args?.filePath ?? args?.file ?? "unknown") as string;
    const fileName = filePath.split("/").pop() ?? filePath;
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const meta = EXT_META[ext] ?? { icon: File, color: "bg-muted text-muted-foreground", label: ext.toUpperCase() || "File" };
    const contentLen = typeof args?.content === "string" ? args.content.length : 0;
    const sizeLabel = contentLen > 1024 ? `${(contentLen / 1024).toFixed(1)} KB` : contentLen > 0 ? `${contentLen} B` : "";
    const isComplete = status?.type !== "running";

    return (
      <ToolCard
        icon={meta.icon}
        iconColor={meta.color}
        title={fileName}
        subtitle={`${action} · ${meta.label}${sizeLabel ? ` · ${sizeLabel}` : ""}`}
        status={status?.type ?? "complete"}
      >
        {isComplete && onOpenFile && (
          <button
            type="button"
            onClick={() => onOpenFile(filePath)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowSquareOut className="size-3" />
            View in panel
          </button>
        )}
      </ToolCard>
    );
  };
}

export const WriteFileToolUI = makeAssistantToolUI({
  toolName: "Write File",
  render: fileToolRender("Created"),
});

export const EditFileToolUI = makeAssistantToolUI({
  toolName: "Edit File",
  render: fileToolRender("Edited"),
});

export const ReadFileToolUI = makeAssistantToolUI({
  toolName: "Read File",
  render: fileToolRender("Read"),
});

/* ── Search tools ──────────────────────────── */

export const SearchFilesToolUI = makeAssistantToolUI({
  toolName: "Search Files",
  render: ({ args, status }) => {
    const pattern = typeof args?.pattern === "string" ? args.pattern : "";
    return (
      <ToolCard
        icon={MagnifyingGlass}
        iconColor="bg-purple-50 text-purple-500 dark:bg-purple-950 dark:text-purple-400"
        title={pattern || "Searching files..."}
        status={status?.type ?? "complete"}
      />
    );
  },
});

export const SearchContentToolUI = makeAssistantToolUI({
  toolName: "Search Content",
  render: ({ args, status }) => {
    const query = typeof args?.query === "string" ? args.query : (typeof args?.pattern === "string" ? args.pattern : "");
    return (
      <ToolCard
        icon={MagnifyingGlass}
        iconColor="bg-purple-50 text-purple-500 dark:bg-purple-950 dark:text-purple-400"
        title={query || "Searching content..."}
        status={status?.type ?? "complete"}
      />
    );
  },
});

/* ── Task Progress ─────────────────────────── */

export const TaskProgressToolUI = makeAssistantToolUI({
  toolName: "Task Progress",
  render: ({ args, status }) => {
    const title = typeof args?.task === "string" ? args.task : "Updating tasks...";
    return (
      <ToolCard
        icon={Check}
        iconColor="bg-success-subtle text-success"
        title={title}
        status={status?.type ?? "complete"}
      />
    );
  },
});

/* ── Announce Artifact (custom OpenCode tool) ─── */
//
// The agent calls this tool to say "here's something the user should
// see." We don't need a fancy card body — the real UX is the
// artifact showing up in the top-right Artifacts drawer. This card
// is the inline chat breadcrumb: "Published: X".
//
// Render is called many times as args stream in. `useArtifactPush`
// hook below dedups by a stable id so the drawer only sees one
// entry per tool call regardless of how many times this renders.
//
// The toolName must match what OpenCode emits for the custom tool
// in `.opencode/tools/announce_artifact.ts` — we expect snake_case
// filename-derived name. If OpenCode emits a different name on
// first test, bump this string; no other code needs to change.

function useArtifactPush(
  args: Record<string, unknown> | undefined,
): void {
  const { announce } = useArtifacts();
  const kind = args?.kind as string | undefined;
  const title = args?.title as string | undefined;
  const port = args?.port as number | undefined;
  const path = args?.path as string | undefined;
  const description = args?.description as string | undefined;

  // Fire announce after render commits — setting state in the
  // artifacts provider while assistant-ui is rendering this tool
  // component would trigger React's "update during render of a
  // different component" warning. The provider's content-level
  // dedup (see artifacts-context.tsx) makes repeated fires
  // harmless, so we can just depend on every arg field.
  //
  // This is the same "useEffect is the right tool for prop→context
  // dispatch" exception documented in agent-chat.tsx's session-
  // sync block. eslint-disable only the deps check — all deps
  // are listed; we just want the closure to capture fresh args
  // on every render.
  useEffect(() => {
    if (typeof kind !== "string" || typeof title !== "string") return;
    if (port == null && path == null && kind !== "report") return;
    // Stable id derived from content — same tool call with the
    // same args produces the same id, which the provider then
    // content-dedups against.
    const id = `artifact:${title}:${port ?? path ?? kind}`;
    announce({
      id,
      kind: kind as "webapp" | "page" | "file" | "report",
      title,
      port,
      path,
      description,
    });
  }, [announce, kind, title, port, path, description]);
}

function AnnouncedArtifact({
  args,
  status,
}: {
  args: Record<string, unknown> | undefined;
  status: { type?: string } | undefined;
}) {
  useArtifactPush(args);
  const { agentId, onOpenFile } = useAgentContext();

  // Triangle rise the first time this tool call finalizes. Render runs
  // many times as args stream in — gate on status + a ref keyed by the
  // stable artifact id so we play exactly once per announcement.
  const playArtifactAnnounced = useSound(ARTIFACT_ANNOUNCED);
  const playedForIdRef = useRef<string | null>(null);

  const kind = typeof args?.kind === "string" ? args.kind : undefined;
  const title = announceArtifactTitle(args);
  const description =
    typeof args?.description === "string" ? args.description : undefined;
  const port =
    typeof args?.port === "number"
      ? args.port
      : typeof args?.port === "string"
        ? Number(args.port)
        : undefined;
  const path = typeof args?.path === "string" ? args.path : undefined;

  const isWebapp = kind === "webapp" || kind === "page";
  const isFile = kind === "file" || kind === "report";

  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openWebapp() {
    if (!agentId || port == null || Number.isNaN(port)) return;
    setOpening(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${agentId}/preview?port=${port}`,
      );
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open preview");
    } finally {
      setOpening(false);
    }
  }

  function openFile() {
    if (path && onOpenFile) onOpenFile(path);
  }

  const isComplete = status?.type !== "running";

  // Fire the chime once per finalized artifact. Uses the same stable id
  // shape as useArtifactPush so the two always agree on "this is one
  // artifact," regardless of how many render passes stream the args in.
  const playId =
    typeof title === "string" &&
    typeof kind === "string" &&
    (port != null || path != null || kind === "report")
      ? `artifact:${title}:${port ?? path ?? kind}`
      : null;
  useEffect(() => {
    if (!isComplete || !playId) return;
    if (playedForIdRef.current === playId) return;
    playedForIdRef.current = playId;
    playArtifactAnnounced();
  }, [isComplete, playId, playArtifactAnnounced]);

  const subtitle =
    description ??
    (isWebapp && port != null
      ? `Running on port ${port}`
      : isFile && path
        ? path.split("/").pop()
        : undefined);

  const canOpenWebapp = isWebapp && port != null && !Number.isNaN(port);
  const canOpenFile = isFile && !!path;
  const showAction = isComplete && (canOpenWebapp || canOpenFile);

  return (
    <ToolCard
      icon={isWebapp ? Monitor : isFile ? FileText : Sparkle}
      iconColor={
        isWebapp
          ? "bg-info-subtle text-info"
          : isFile
            ? "bg-muted text-muted-foreground"
            : "bg-success-subtle text-success"
      }
      title={title}
      subtitle={subtitle}
      status={status?.type ?? "complete"}
    >
      {showAction && (
        <button
          type="button"
          onClick={canOpenWebapp ? openWebapp : openFile}
          disabled={opening}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-3.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
        >
          {opening ? (
            <Spinner context="button" className="text-[10px]" />
          ) : canOpenWebapp ? (
            <ArrowSquareOut className="size-3" />
          ) : (
            <FileText className="size-3" />
          )}
          {opening
            ? "Opening…"
            : canOpenWebapp
              ? "Open website"
              : "View in panel"}
        </button>
      )}
      {error && (
        <div className="border-t border-border bg-destructive/5 px-3.5 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}
    </ToolCard>
  );
}

export const AnnounceArtifactToolUI = makeAssistantToolUI({
  toolName: "announce_artifact",
  render: (props) => (
    <AnnouncedArtifact
      args={props.args as Record<string, unknown> | undefined}
      status={props.status as { type?: string } | undefined}
    />
  ),
});
