"use client";

import { useEffect, useState } from "react";
import { FileText } from "@phosphor-icons/react";
import { DownloadSimple } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/unicode-spinner";
import { cn } from "@/lib/utils";
import { getFileLabel } from "@/lib/files/file-icon";

/**
 * File-content view used by `kind: "file"` deliveries (and elsewhere
 * the right panel needs to show a single file). Extracted from the
 * old FileSheet body so the panel host can compose it without
 * dragging Radix Sheet along.
 */
export function FileViewer({
  agentId,
  path,
}: {
  agentId: string;
  path: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/agents/${agentId}/file?path=${encodeURIComponent(path)}`,
        );
        const data = (await res.json()) as { error?: string; content?: unknown };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          setContent(null);
        } else {
          setContent(typeof data.content === "string" ? data.content : "");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't read file");
        setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [agentId, path]);

  const fileName = path.split("/").pop() ?? path;
  const typeLabel = fileName ? getFileLabel(fileName) : "";
  function download() {
    if (!content || !fileName) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/40">
          <FileText size={18} weight="regular" className="text-foreground/70" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{fileName}</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {path}
          </p>
          {typeLabel && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              {typeLabel}
              {content != null && ` · ${formatSize(content.length)}`}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={download}
          disabled={!content}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Download"
        >
          <DownloadSimple className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        {loading && content === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner context="loading" />
          </div>
        ) : error ? (
          <div className="p-6">
            <p className="text-sm text-destructive">Couldn&apos;t read file</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{error}</p>
          </div>
        ) : content === "" ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Empty file</p>
          </div>
        ) : (
          <pre
            className={cn(
              "whitespace-pre p-5 font-mono text-[12px] leading-relaxed text-foreground/85",
            )}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
