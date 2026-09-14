"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretRight,
  Folder,
  Globe,
  Terminal,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/unicode-spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { WorkspaceFile } from "@/lib/types";

type Mode = "preview" | "files" | "console";

export function ArtifactPanel({
  agentId,
  onClose,
  autoPort,
  openFilePath,
}: {
  agentId: string;
  onClose: () => void;
  autoPort?: string | null;
  openFilePath?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(autoPort ? "preview" : openFilePath ? "files" : "preview");
  const prevFilePathRef = useRef(openFilePath);

  // Switch to files mode when a new file is requested
  useEffect(() => {
    if (!openFilePath || openFilePath === prevFilePathRef.current) return;
    prevFilePathRef.current = openFilePath;
    queueMicrotask(() => {
      setMode((currentMode) => (currentMode === "files" ? currentMode : "files"));
    });
  }, [openFilePath]);

  return (
    <div className="flex h-full w-full shrink-0 flex-col overflow-hidden border-l border-border bg-background sm:w-[440px]">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("preview")}
            aria-label="Preview"
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "preview"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Globe className="mr-1 inline size-3" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("console")}
            aria-label="Console"
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "console"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Terminal className="mr-1 inline size-3" />
            Console
          </button>
          <button
            type="button"
            onClick={() => setMode("files")}
            aria-label="Files"
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "files"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <TreeStructure className="mr-1 inline size-3" />
            Files
          </button>
        </div>
        <Button variant="ghost" size="icon-xs" className="size-6" onClick={onClose} aria-label="Close panel">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      {mode === "preview" && <PreviewMode agentId={agentId} autoPort={autoPort} />}
      {mode === "console" && <ConsoleMode agentId={agentId} />}
      {mode === "files" && <FilesMode agentId={agentId} openFilePath={openFilePath} />}
    </div>
  );
}

/* ── Preview Mode: iframe with port selector ── */

function PreviewMode({ agentId, autoPort }: { agentId: string; autoPort?: string | null }) {
  const [port, setPort] = useState(autoPort ?? "3000");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreviewForPort = useCallback(async (requestedPort: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/preview?port=${requestedPort}`);
      const data = await res.json();
      if (data.url) {
        setPreviewUrl(data.url);
      } else {
        setError(data.error ?? "No preview URL");
      }
    } catch {
      setError("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Initial port is derived from `autoPort` in useState above. If the
  // parent passes one, also fetch its preview URL on mount. The
  // parent is responsible for remounting this component (via `key` or
  // by unmounting at `mode !== "preview"`) when the autoPort value
  // changes — we intentionally don't react to post-mount changes
  // because users can select their own port once the panel is open.
  useMountEffect(() => {
    if (autoPort) loadPreviewForPort(autoPort);
  });

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/preview?port=${port}`);
      const data = await res.json();
      if (data.url) {
        setPreviewUrl(data.url);
      } else {
        setError(data.error ?? "No preview URL");
      }
    } catch {
      setError("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Port input */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">Port:</span>
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="h-7 w-20 font-mono text-[12px]"
          placeholder="3000"
          onKeyDown={(e) => e.key === "Enter" && loadPreview()}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={loadPreview}
          disabled={loading}
          className="h-7 gap-1 text-[11px]"
        >
          {loading ? (
            <Spinner context="loading" className="text-xs" />
          ) : (
            <Globe className="size-3" />
          )}
          {loading ? "" : "Open"}
        </Button>
        {previewUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1 text-[11px]"
            onClick={() => window.open(previewUrl, "_blank")}
          >
            <ArrowSquareOut className="size-3" />
          </Button>
        )}
      </div>

      {/* iframe */}
      {previewUrl ? (
        <iframe
          src={previewUrl}
          className="flex-1 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="Sandbox preview"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : (
            <>
              <Globe className="size-8 text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">
                Enter a port number to preview your agent&apos;s running services
              </p>
              <p className="text-[11px] text-muted-foreground/60">
                Ask your agent to start a web server, then enter the port here
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Files Mode: workspace browser + viewer ── */

/* ── Console Mode: command runner ── */

type CommandEntry = {
  command: string;
  output: string;
  exitCode: number;
};

function ConsoleMode({ agentId }: { agentId: string }) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<CommandEntry[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function runCommand() {
    const cmd = command.trim();
    if (!cmd || running) return;

    setCommand("");
    setRunning(true);

    try {
      const res = await fetch(`/api/agents/${agentId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      setHistory((h) => [
        ...h,
        {
          command: cmd,
          output: data.output ?? data.error ?? "",
          exitCode: data.exitCode ?? -1,
        },
      ]);
    } catch {
      setHistory((h) => [
        ...h,
        { command: cmd, output: "Failed to execute command", exitCode: -1 },
      ]);
    } finally {
      setRunning(false);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-950">
      {/* Output — native overflow, not Radix ScrollArea. ScrollArea in flex
          layouts jams once content exceeds a few screens worth of text. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-3 font-mono text-[12px]">
          {history.length === 0 && !running && (
            <p className="text-zinc-500">
              Run commands in your agent&apos;s sandbox. Type a command below.
            </p>
          )}
          {history.map((entry, i) => (
            <div key={i} className="mb-3">
              <div className="flex items-center gap-1.5 text-success">
                <span className="text-zinc-500">$</span>
                <span>{entry.command}</span>
              </div>
              {entry.output && (
                <pre className="mt-1 whitespace-pre-wrap text-zinc-300">
                  {entry.output}
                </pre>
              )}
              {entry.exitCode !== 0 && (
                <span className="text-[10px] text-destructive">
                  exit code: {entry.exitCode}
                </span>
              )}
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-zinc-500">
              <Spinner context="running" label="Running..." className="text-xs" />
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
        <span className="font-mono text-[12px] text-success">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runCommand()}
          placeholder="Enter command..."
          disabled={running}
          className="flex-1 bg-transparent font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
      </div>
    </div>
  );
}

/* ── Files Mode: workspace browser + viewer ── */

const FILE_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  html: { icon: "🌐", color: "text-warning", label: "HTML" },
  css: { icon: "🎨", color: "text-info", label: "CSS" },
  js: { icon: "⚡", color: "text-warning", label: "JavaScript" },
  ts: { icon: "💎", color: "text-info", label: "TypeScript" },
  jsx: { icon: "⚛️", color: "text-cyan-500", label: "React" },
  tsx: { icon: "⚛️", color: "text-cyan-600", label: "React TS" },
  py: { icon: "🐍", color: "text-success", label: "Python" },
  json: { icon: "📋", color: "text-warning", label: "JSON" },
  md: { icon: "📝", color: "text-gray-500", label: "Markdown" },
  txt: { icon: "📄", color: "text-gray-400", label: "Text" },
  sh: { icon: "⚙️", color: "text-success", label: "Shell" },
  yaml: { icon: "📐", color: "text-destructive", label: "YAML" },
  yml: { icon: "📐", color: "text-destructive", label: "YAML" },
  csv: { icon: "📊", color: "text-success", label: "CSV" },
};

function getFileInfo(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? { icon: "📄", color: "text-muted-foreground", label: ext.toUpperCase() || "File" };
}

function FilesMode({ agentId, openFilePath }: { agentId: string; openFilePath?: string | null }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // Lazy loading: children are fetched on first expand, keyed by directory path.
  // This is what keeps the tree fast regardless of project size — we only pay
  // for directories the user actually opens.
  const [childrenCache, setChildrenCache] = useState<Map<string, WorkspaceFile[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const autoOpenedRef = useRef(false);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/files`);
      const data = await res.json();
      if (Array.isArray(data?.files)) setFiles(data.files);
    } catch {
      // swallow — tree stays empty, user can retry via refresh
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  const fetchDirChildren = useCallback(
    async (dirPath: string) => {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      try {
        const res = await fetch(
          `/api/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`,
        );
        const data = await res.json();
        if (Array.isArray(data?.files)) {
          setChildrenCache((prev) => {
            const next = new Map(prev);
            next.set(dirPath, data.files);
            return next;
          });
        }
      } catch {
        // swallow — user can collapse and retry via re-expand
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
    loadFiles().then(() => {
      // Auto-open file if path was provided on mount
      if (openFilePath && !autoOpenedRef.current) {
        autoOpenedRef.current = true;
        const name = openFilePath.split("/").pop() ?? openFilePath;
        openFile(openFilePath, name);
      }
    });
  });

  function toggleDir(node: WorkspaceFile) {
    const wasExpanded = expandedDirs.has(node.id);

    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(node.id);
      else next.add(node.id);
      return next;
    });

    // Fetch children on first expand. Cached results are reused on subsequent
    // expand/collapse cycles — no refetch unless the user clicks refresh.
    if (!wasExpanded && !childrenCache.has(node.path)) {
      void fetchDirChildren(node.path);
    }
  }

  async function openFile(path: string, name: string) {
    setLoadingFile(true);
    setSelectedPath(path);
    setSelectedName(name);
    try {
      const res = await fetch(
        `/api/agents/${agentId}/file?path=${encodeURIComponent(path)}`,
      );
      const data = await res.json();
      setFileContent(data.content ?? "");
    } catch {
      setFileContent("Failed to load file");
    } finally {
      setLoadingFile(false);
    }
  }

  function refreshFiles() {
    setIsLoading(true);
    // Drop cached children and collapse — tree might have changed shape,
    // cleanest reset is to start from scratch.
    setChildrenCache(new Map());
    setExpandedDirs(new Set());
    void loadFiles();
  }

  // If a file is open, show the viewer
  if (selectedPath) {
    const info = getFileInfo(selectedName);
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* File header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-sm">{info.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">{selectedName}</p>
            <p className="text-[10px] text-muted-foreground">{info.label}</p>
          </div>
          <Button variant="ghost" size="icon-xs" className="size-6" onClick={() => setSelectedPath(null)}>
            <X className="size-3.5" />
          </Button>
        </div>
        {/* Code viewer — native scroll, not ScrollArea */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loadingFile ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground"><Spinner context="loading" className="text-xs" /></div>
          ) : (
            <pre className="p-4 font-mono text-[12px] leading-relaxed text-foreground">
              {fileContent.split("\n").map((line, i) => (
                <div key={i} className="flex">
                  <span className="mr-4 inline-block w-8 select-none text-right text-muted-foreground/40">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">{line || " "}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // File tree view
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[12px] font-medium text-foreground">Workspace</span>
        <Button variant="ghost" size="icon-xs" className="size-6" onClick={refreshFiles}>
          <ArrowsClockwise className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner context="loading" className="text-sm text-muted-foreground/60" />
            </div>
          ) : files.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">
              No files yet. Ask your agent to create something.
            </p>
          ) : (
            files.map((node) => (
              <FileNode
                key={node.id}
                node={node}
                depth={0}
                expandedDirs={expandedDirs}
                childrenCache={childrenCache}
                loadingDirs={loadingDirs}
                onToggle={toggleDir}
                onOpenFile={openFile}
                selectedPath={selectedPath}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function FileNode({
  node,
  depth,
  expandedDirs,
  childrenCache,
  loadingDirs,
  onToggle,
  onOpenFile,
  selectedPath,
}: {
  node: WorkspaceFile;
  depth: number;
  expandedDirs: Set<string>;
  childrenCache: Map<string, WorkspaceFile[]>;
  loadingDirs: Set<string>;
  onToggle: (node: WorkspaceFile) => void;
  onOpenFile: (path: string, name: string) => void;
  selectedPath: string | null;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.id);
  const isLoadingChildren = loadingDirs.has(node.path);
  const cachedChildren = childrenCache.get(node.path);
  const fileInfo = !isDir ? getFileInfo(node.name) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node) : onOpenFile(node.path, node.name))}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors hover:bg-accent/50",
          node.path === selectedPath && "bg-accent",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          <CaretRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          <Folder className="size-4 shrink-0 text-warning/70" />
        ) : (
          <span className="shrink-0 text-[14px]">{fileInfo?.icon ?? "📄"}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-left text-foreground">{node.name}</span>
        {node.size && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {node.size}
          </span>
        )}
      </button>
      {isDir && isExpanded && (
        <>
          {isLoadingChildren && !cachedChildren ? (
            <div
              className="flex items-center py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <Spinner context="loading" className="text-xs text-muted-foreground/60" />
            </div>
          ) : (
            cachedChildren?.map((child) => (
              <FileNode
                key={child.id}
                node={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                childrenCache={childrenCache}
                loadingDirs={loadingDirs}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                selectedPath={selectedPath}
              />
            ))
          )}
        </>
      )}
    </>
  );
}
