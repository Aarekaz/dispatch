"use client";

import { useCallback, useState } from "react";
import {
  ArrowsClockwise,
  Brain,
  CaretRight,
  FileText,
  FolderSimple,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";

import type { WorkspaceFile, MemoryFile } from "@/lib/types";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useOnSandboxWake } from "@/hooks/use-sandbox-wake";
import { useSandbox } from "@/hooks/use-sandbox";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/unicode-spinner";

export type FileSelection =
  | { kind: "memory"; file: MemoryFile }
  | { kind: "workspace"; file: WorkspaceFile };

/**
 * The agent's file tree — Knowledge section (memory files) on top,
 * Workspace section (lazy-loaded sandbox tree) below.
 *
 * Workspace is backed by a Convex mirror: when the sandbox is stopped
 * we render the cached tree + a "cached view · wake to refresh" banner
 * instead of silently starting the VM. When running, we serve live and
 * refresh the mirror in the background.
 */
export function FileTree({
  agentId,
  selectedPath,
  onSelect,
  memoryRefreshKey = 0,
}: {
  agentId: string;
  selectedPath: string | null;
  onSelect: (selection: FileSelection) => void;
  /** Bump to force re-fetch of memory files (e.g. after save). */
  memoryRefreshKey?: number;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <KnowledgeSection
          agentId={agentId}
          selectedPath={selectedPath}
          onSelect={onSelect}
          refreshKey={memoryRefreshKey}
        />
        <WorkspaceSection
          agentId={agentId}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Knowledge section — memory files (editable)
   ───────────────────────────────────────────── */

function KnowledgeSection({
  agentId,
  selectedPath,
  onSelect,
  refreshKey,
}: {
  agentId: string;
  selectedPath: string | null;
  onSelect: (selection: FileSelection) => void;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [error, setError] = useState(false);

  const fetchMemory = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/agents/${agentId}/memory`);
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      setError(true);
      setFiles([]);
    }
  }, [agentId]);

  useMountEffect(() => {
    void fetchMemory();
  });

  // Re-fetch when refreshKey changes (derived via a ref-like guard)
  const [lastKey, setLastKey] = useState(refreshKey);
  if (lastKey !== refreshKey) {
    setLastKey(refreshKey);
    void fetchMemory();
  }

  return (
    <section>
      <SectionHeader icon={<Brain className="size-3" />} label="Knowledge" />
      {files === null ? (
        <LoadingRow />
      ) : error ? (
        <EmptyRow>Couldn&apos;t load</EmptyRow>
      ) : files.length === 0 ? (
        <EmptyRow>No memories yet</EmptyRow>
      ) : (
        files.map((file) => (
          <FileRow
            key={file.path}
            name={file.name}
            path={file.path}
            depth={0}
            isActive={selectedPath === file.path}
            onClick={() => onSelect({ kind: "memory", file })}
          />
        ))
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────
   Workspace section — cached mirror + lazy tree
   ───────────────────────────────────────────── */

type RootState = {
  files: WorkspaceFile[];
  cached: boolean;
  lastSyncedAt: number | null;
};

function WorkspaceSection({
  agentId,
  selectedPath,
  onSelect,
}: {
  agentId: string;
  selectedPath: string | null;
  onSelect: (selection: FileSelection) => void;
}) {
  const sandbox = useSandbox(agentId);
  const sandboxState = sandbox.data?.state;
  const isWaking =
    sandbox.isMutating ||
    sandboxState === "starting" ||
    sandboxState === "stopping";

  const [root, setRoot] = useState<RootState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<
    Map<string, WorkspaceFile[]>
  >(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const loadRoot = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/files`);
      const data = await res.json();
      setRoot({
        files: Array.isArray(data?.files) ? data.files : [],
        cached: !!data?.cached,
        lastSyncedAt:
          typeof data?.lastSyncedAt === "number" ? data.lastSyncedAt : null,
      });
    } catch {
      setRoot({ files: [], cached: false, lastSyncedAt: null });
    }
  }, [agentId]);

  const fetchDir = useCallback(
    async (dirPath: string) => {
      setLoadingDirs((prev) => new Set(prev).add(dirPath));
      try {
        const res = await fetch(
          `/api/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`,
        );
        const data = await res.json();
        if (Array.isArray(data?.files)) {
          setChildrenCache((prev) =>
            new Map(prev).set(dirPath, data.files),
          );
        }
      } catch {
        // swallow — collapse/re-expand retries
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [agentId],
  );

  useMountEffect(() => {
    void loadRoot();
  });

  // Refresh the tree when the sandbox wakes from elsewhere (e.g. the
  // user clicks Reload in the SandboxPill popover while looking at a
  // cached tree). Guarded behind `root?.cached` so live trees don't
  // get redundantly re-fetched on every wake event.
  useOnSandboxWake(sandboxState, () => {
    if (!root?.cached) return;
    void loadRoot();
    for (const dir of Array.from(childrenCache.keys())) {
      void fetchDir(dir);
    }
  });

  function toggleDir(node: WorkspaceFile) {
    const wasExpanded = expanded.has(node.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    if (!wasExpanded && !childrenCache.has(node.path)) {
      void fetchDir(node.path);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setChildrenCache(new Map());
    setExpanded(new Set());
    await loadRoot();
    setRefreshing(false);
  }

  async function handleWake() {
    await sandbox.restart();
    // `useOnSandboxWake` above will re-fetch the tree once Daytona
    // reports "running". No direct call here.
  }

  const neverSynced =
    root !== null && root.cached && root.lastSyncedAt === null;
  const showCachedBanner = root !== null && root.cached && !neverSynced;

  return (
    <section className="mt-4">
      <SectionHeader
        icon={<FolderSimple className="size-3" />}
        label="Workspace"
        action={
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || root?.cached}
            aria-label="Refresh workspace"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <ArrowsClockwise
              className={cn(
                "size-3 transition-transform",
                refreshing && "animate-spin",
              )}
            />
          </button>
        }
      />

      {showCachedBanner && (
        <CachedBanner
          lastSyncedAt={root.lastSyncedAt}
          onWake={handleWake}
          waking={isWaking}
        />
      )}

      {root === null ? (
        <LoadingRow />
      ) : neverSynced ? (
        <StoppedEmptyState onWake={handleWake} waking={isWaking} />
      ) : root.files.length === 0 ? (
        <EmptyRow>No files yet</EmptyRow>
      ) : (
        root.files.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            childrenCache={childrenCache}
            loadingDirs={loadingDirs}
            selectedPath={selectedPath}
            onToggle={toggleDir}
            onSelectFile={(f) => onSelect({ kind: "workspace", file: f })}
          />
        ))
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────
   Recursive tree node
   ───────────────────────────────────────────── */

function TreeNode({
  node,
  depth,
  expanded,
  childrenCache,
  loadingDirs,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  node: WorkspaceFile;
  depth: number;
  expanded: Set<string>;
  childrenCache: Map<string, WorkspaceFile[]>;
  loadingDirs: Set<string>;
  selectedPath: string | null;
  onToggle: (node: WorkspaceFile) => void;
  onSelectFile: (node: WorkspaceFile) => void;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expanded.has(node.id);
  const isLoadingChildren = loadingDirs.has(node.path);
  const cached = childrenCache.get(node.path);
  const isActive = node.path === selectedPath;

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node) : onSelectFile(node))}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[13px] transition-colors",
          isActive
            ? "bg-foreground/[0.06] text-foreground"
            : "text-foreground/90 hover:bg-foreground/[0.03]",
        )}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
      >
        {isDir ? (
          <CaretRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/60 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          <FolderSimple className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileIconLucide />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isDir && isExpanded && (
        <>
          {isLoadingChildren && !cached ? (
            <div
              className="flex py-1"
              style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
            >
              <Spinner
                context="loading"
                className="text-[10px] text-muted-foreground/60"
              />
            </div>
          ) : (
            cached?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                childrenCache={childrenCache}
                loadingDirs={loadingDirs}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Cached state UI
   ───────────────────────────────────────────── */

function CachedBanner({
  lastSyncedAt,
  onWake,
  waking,
}: {
  lastSyncedAt: number | null;
  onWake: () => void;
  waking: boolean;
}) {
  return (
    <div className="mx-3 mb-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <WarningCircle className="mt-px size-3.5 shrink-0" />
        <span className="flex-1 leading-snug">
          Sandbox is stopped — showing cached view
          {lastSyncedAt ? ` · synced ${formatRelativeTime(lastSyncedAt)}` : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={onWake}
        disabled={waking}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-border/60 bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {waking ? (
          <Spinner context="button" className="text-[10px]" />
        ) : (
          <Play className="size-3" />
        )}
        {waking ? "Waking…" : "Wake sandbox"}
      </button>
    </div>
  );
}

function StoppedEmptyState({
  onWake,
  waking,
}: {
  onWake: () => void;
  waking: boolean;
}) {
  return (
    <div className="mx-3 mt-2 rounded-md border border-dashed border-border/60 p-4 text-center">
      <p className="text-xs text-muted-foreground">
        Sandbox is stopped and hasn&apos;t been browsed yet.
      </p>
      <button
        type="button"
        onClick={onWake}
        disabled={waking}
        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {waking ? (
          <Spinner context="button" className="text-[10px]" />
        ) : (
          <Play className="size-3" />
        )}
        {waking ? "Waking…" : "Wake sandbox"}
      </button>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ─────────────────────────────────────────────
   Presentational atoms
   ───────────────────────────────────────────── */

function SectionHeader({
  icon,
  label,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      {action}
    </div>
  );
}

function FileRow({
  name,
  depth,
  isActive,
  onClick,
}: {
  name: string;
  path: string;
  depth: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[13px] transition-colors",
        isActive
          ? "bg-foreground/[0.06] text-foreground"
          : "text-foreground/90 hover:bg-foreground/[0.03]",
      )}
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
    >
      <span className="w-3 shrink-0" />
      <FileIconLucide />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

function FileIconLucide() {
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground/60">
      <Spinner context="loading" className="text-[10px]" />
      Loading
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-2 text-[12px] text-muted-foreground/60">{children}</p>
  );
}
