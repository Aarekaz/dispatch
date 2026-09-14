"use client";

import { Copy, Check } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/agent-elements/markdown";

/**
 * Text-deliverable view: renders a delivery's `content` as markdown
 * (the same renderer the chat uses, so headings/code blocks/etc. all
 * land as expected). Header has the title + a copy button.
 */
export function TextViewer({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-3.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyAll}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <Markdown content={content} className="text-[14px] leading-relaxed" />
      </div>
    </div>
  );
}
