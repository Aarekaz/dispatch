"use client";

import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { Check as CheckIcon, File as FileIcon, FileCode as FileCodeIcon, FileText as FileTextIcon } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/unicode-spinner";
import { cn } from "@/lib/utils";

const EXT_ICONS: Record<string, { icon: typeof FileIcon; color: string; label: string }> = {
  html: { icon: FileCodeIcon, color: "text-warning bg-warning-subtle", label: "HTML" },
  css: { icon: FileCodeIcon, color: "text-info bg-info-subtle", label: "CSS" },
  js: { icon: FileCodeIcon, color: "text-warning bg-warning-subtle", label: "JavaScript" },
  ts: { icon: FileCodeIcon, color: "text-info bg-info-subtle", label: "TypeScript" },
  jsx: { icon: FileCodeIcon, color: "text-warning bg-warning-subtle", label: "React" },
  tsx: { icon: FileCodeIcon, color: "text-info bg-info-subtle", label: "React TS" },
  py: { icon: FileCodeIcon, color: "text-success bg-success-subtle", label: "Python" },
  json: { icon: FileCodeIcon, color: "text-warning bg-warning-subtle", label: "JSON" },
  md: { icon: FileTextIcon, color: "text-gray-500 bg-gray-50", label: "Markdown" },
  txt: { icon: FileTextIcon, color: "text-gray-400 bg-gray-50", label: "Text" },
  sh: { icon: FileCodeIcon, color: "text-success bg-success-subtle", label: "Shell" },
};

function getFileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function FileCard({
  input,
  status,
}: {
  input: { file_path?: string; path?: string; content?: string; command?: string };
  status?: ToolCallMessagePartStatus;
}) {
  const filePath = input.file_path ?? input.path ?? "unknown";
  const fileName = getFileName(filePath);
  const ext = getFileExt(fileName);
  const meta = EXT_ICONS[ext] ?? { icon: FileIcon, color: "text-muted-foreground bg-muted", label: ext.toUpperCase() || "File" };
  const Icon = meta.icon;
  const isRunning = status?.type === "running";
  const contentLength = typeof input.content === "string" ? input.content.length : 0;
  const sizeLabel = contentLength > 1024
    ? `${(contentLength / 1024).toFixed(1)} KB`
    : contentLength > 0
      ? `${contentLength} B`
      : "";

  return (
    <div className="my-1 inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/30">
      {/* File type icon */}
      <div className={cn("flex size-10 items-center justify-center rounded-lg", meta.color)}>
        <Icon className="size-5" />
      </div>

      {/* File info */}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">{fileName}</p>
        <p className="text-[11px] text-muted-foreground">
          {meta.label}
          {sizeLabel && ` · ${sizeLabel}`}
        </p>
      </div>

      {/* Status */}
      <div className="ml-2">
        {isRunning ? (
          <Spinner context="loading" className="text-sm text-muted-foreground" />
        ) : (
          <CheckIcon className="size-4 text-success" />
        )}
      </div>
    </div>
  );
}
