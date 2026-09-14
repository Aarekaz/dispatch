"use client";

import { createContext, memo, useContext, useState } from "react";
import { ArrowsOutSimple, CaretDown } from "@phosphor-icons/react";
import { ToolRenderer as DefaultToolRenderer } from "@/components/agent-elements/tools/tool-renderer";
import type { ToolRendererProps } from "@/components/agent-elements/tools/tool-renderer";
import { cn } from "@/lib/utils";
import { useRightPanel } from "./right-panel-store";

/**
 * agent-elements' `slots.ToolRenderer` is given only the part — no
 * message id. We thread the toolCallId → messageId mapping through a
 * tiny context so the wrapped renderer can open the right-panel
 * trace at exactly the right tool call.
 */
export const ToolMessageMapContext = createContext<
  Map<string, string> | null
>(null);

/**
 * Tool part types whose specialized renderer already shows the full
 * input + output inline. The "Show request / response" toggle would
 * just duplicate what the card displays.
 */
const RENDERS_FULL_CONTENT = new Set<string>([
  "tool-Bash",
  "tool-Edit",
  "tool-Write",
  "tool-TodoWrite",
  "tool-PlanWrite",
  "tool-Thinking",
]);

/**
 * Wraps agent-elements' ToolRenderer with two affordances:
 *   1. "Show request / response" — inline collapsible JSON for tools
 *      whose registry card hides the input/output (Read, Grep, Glob,
 *      WebSearch, generic, MCP).
 *   2. "Open in panel" — pushes the message's trace into the
 *      right-side panel highlighted on this tool call. Visible on
 *      every tool card regardless of inline content.
 */
export const ToolRendererDebug = memo(function ToolRendererDebug(
  props: ToolRendererProps,
) {
  const [open, setOpen] = useState(false);
  const { part } = props;
  const { openTrace } = useRightPanel();
  const map = useContext(ToolMessageMapContext);

  const hasInput =
    part.input != null && Object.keys(part.input as object).length > 0;
  const hasOutput =
    part.output != null && (typeof part.output !== "string" || part.output.length > 0);
  const rendererShowsContent = RENDERS_FULL_CONTENT.has(String(part.type));
  const showInlineToggle = !rendererShowsContent && (hasInput || hasOutput);

  const messageId = part.toolCallId ? map?.get(part.toolCallId) : undefined;

  function openInPanel() {
    if (!messageId) return;
    openTrace({
      messageId,
      highlightToolCallId: part.toolCallId,
    });
  }

  return (
    <div className="group/tool-debug flex flex-col gap-1">
      <DefaultToolRenderer {...props} />

      {(showInlineToggle || messageId) && (
        <div className="ml-9 flex items-center gap-3">
          {showInlineToggle && (
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1 -mx-1 py-0.5",
                "text-[11px] text-muted-foreground/70 hover:text-foreground",
                "transition-colors",
              )}
            >
              <CaretDown
                className={cn(
                  "size-3 transition-transform",
                  open ? "rotate-0" : "-rotate-90",
                )}
              />
              {open ? "Hide" : "Show"} request / response
            </button>
          )}
          {messageId && (
            <button
              type="button"
              onClick={openInPanel}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1 -mx-1 py-0.5",
                "text-[11px] text-muted-foreground/70 hover:text-foreground",
                "transition-colors",
              )}
              title="Open the full message trace in the side panel"
            >
              <ArrowsOutSimple className="size-3" />
              Open in panel
            </button>
          )}
        </div>
      )}

      {open && showInlineToggle && (
        <div className="ml-9 mt-1.5 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] font-mono leading-relaxed">
          {hasInput && <DebugBlock label="Request" value={part.input} />}
          {hasOutput && <DebugBlock label="Response" value={part.output} />}
        </div>
      )}
    </div>
  );
});

function DebugBlock({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        })();
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-sans font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </pre>
    </div>
  );
}
