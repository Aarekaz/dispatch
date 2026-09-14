"use client";

import type { UIMessage } from "ai";
import { Markdown } from "@/components/agent-elements/markdown";

type TraceToolPart = {
  type?: string;
  toolCallId?: string;
  title?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};

/**
 * Process-trace view: lists every tool call from a single assistant
 * message with its raw input + output. Mounted in the right panel
 * when the user clicks a milestone group's "Open in panel" affordance
 * or pastes a `?panel=trace:<msgId>` link.
 *
 * The trace is intentionally verbose — it's the audit surface, not
 * the scannable chat card. For each tool call we show the friendly
 * label, the part type, the input as JSON, and the output as the raw
 * value (string or pretty-printed JSON).
 */
export function TraceViewer({
  messageId,
  messages,
  highlightToolCallId,
}: {
  messageId: string;
  messages: UIMessage[];
  highlightToolCallId?: string;
}) {
  const message = messages.find((m) => m.id === messageId);

  if (!message) {
    return (
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-border/60 px-5 py-3.5">
          <h3 className="text-sm font-medium">Trace</h3>
        </header>
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            No trace available for this message.
          </p>
        </div>
      </div>
    );
  }

  const toolParts = (message.parts ?? [])
    .filter(
      (p) =>
        typeof (p as TraceToolPart).type === "string" &&
        ((p as TraceToolPart).type as string).startsWith("tool-"),
    )
    .map((part) => part as TraceToolPart);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border/60 px-5 py-3.5">
        <h3 className="text-sm font-medium">Process trace</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {toolParts.length} tool call{toolParts.length === 1 ? "" : "s"} ·{" "}
          message {messageId.slice(-8)}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
        {toolParts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tool calls in this turn.
          </p>
        ) : (
          toolParts.map((part, i) => {
            const partType = String(part.type);
            const toolName = partType.startsWith("tool-")
              ? partType.slice("tool-".length)
              : partType;
            const isHighlighted =
              highlightToolCallId &&
              part.toolCallId === highlightToolCallId;
            return (
              <section
                key={part.toolCallId ?? `${messageId}-${i}`}
                className={
                  isHighlighted
                    ? "rounded-md border border-foreground/20 bg-muted/40 p-3"
                    : "rounded-md border border-border/40 bg-muted/20 p-3"
                }
              >
                <header className="mb-2 flex items-baseline justify-between gap-3">
                  <h4 className="truncate text-[13px] font-medium">
                    {part.title ?? toolName}
                  </h4>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {part.state ?? "—"}
                  </span>
                </header>

                {part.input !== undefined && (
                  <Block label="Request" value={part.input} />
                )}
                {part.output !== undefined && (
                  <Block label="Response" value={part.output} />
                )}
                {part.errorText !== undefined && part.errorText !== null && (
                  <Block label="Error" value={part.errorText} tone="error" />
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function Block({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone?: "error";
}) {
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
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </div>
      {label === "Response" && tone !== "error" && typeof value === "string" ? (
        // Render long string responses as markdown so code fences and
        // newlines look right; falls back to <pre> for everything else.
        <div className="text-[12px] leading-relaxed">
          <Markdown content={text} />
        </div>
      ) : (
        <pre
          className={
            tone === "error"
              ? "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 p-2 font-mono text-[11px] text-destructive"
              : "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/90"
          }
        >
          {text}
        </pre>
      )}
    </div>
  );
}
