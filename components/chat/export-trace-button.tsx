"use client";

import { useCallback, useState } from "react";
import type { UIMessage } from "ai";
import { Copy, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type TracePart = {
  type?: string;
  title?: string;
  state?: string;
  text?: string;
  message?: string;
  errorText?: unknown;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

/**
 * Copy the full chat trace to the clipboard as markdown — every text
 * turn, every tool call rendered as a fenced block with raw
 * input/output, plus the raw `UIMessage[]` appended as JSON at the
 * end for lossless re-import.
 */
export function ExportTraceButton({
  messages,
  className,
}: {
  messages: UIMessage[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    const md = renderTraceMarkdown(messages);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Insecure context or denied permission — fall back to a hidden
      // textarea + execCommand("copy") so the trace still lands on
      // the clipboard. Doesn't throw.
      const ta = document.createElement("textarea");
      ta.value = md;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        /* give up silently */
      }
      ta.remove();
    }
  }, [messages]);

  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a markdown trace of every text and tool call in this thread to the clipboard"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-1",
        "text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted",
        "transition-colors",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy trace"}
    </button>
  );
}

function renderTraceMarkdown(messages: UIMessage[]): string {
  const lines: string[] = [];
  lines.push(`# Chat trace`);
  lines.push("");
  lines.push(`_Exported ${new Date().toISOString()} · ${messages.length} message(s)_`);
  lines.push("");

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
    lines.push(`## ${role}`);
    lines.push("");

    for (const part of msg.parts ?? []) {
      const p = part as TracePart;
      if (p.type === "text" && typeof p.text === "string") {
        lines.push(p.text);
        lines.push("");
        continue;
      }
      if (p.type === "reasoning" && typeof p.text === "string") {
        lines.push(`> _reasoning:_ ${p.text.replace(/\n/g, "\n> ")}`);
        lines.push("");
        continue;
      }
      if (p.type === "error") {
        lines.push(`**Error${p.title ? ` · ${p.title}` : ""}:** ${p.message ?? ""}`);
        lines.push("");
        continue;
      }
      if (typeof p.type === "string" && (p.type.startsWith("tool-") || p.type === "dynamic-tool")) {
        const toolName =
          p.type === "dynamic-tool"
            ? (p.toolName as string) ?? "tool"
            : p.type.slice("tool-".length);
        const title = (p.title as string) ?? "";
        const state = (p.state as string) ?? "";

        lines.push(
          `### Tool: \`${toolName}\`${title ? ` — ${title}` : ""}${state ? ` · _${state}_` : ""}`,
        );
        lines.push("");
        if (p.input !== undefined) {
          lines.push("**Request**");
          lines.push("```json");
          lines.push(stringifySafe(p.input));
          lines.push("```");
        }
        if (p.output !== undefined) {
          lines.push("**Response**");
          lines.push("```");
          lines.push(typeof p.output === "string" ? p.output : stringifySafe(p.output));
          lines.push("```");
        }
        if (p.errorText) {
          lines.push("**Error**");
          lines.push("```");
          lines.push(String(p.errorText));
          lines.push("```");
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Raw `UIMessage[]`");
  lines.push("");
  lines.push("```json");
  lines.push(stringifySafe(messages));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
