"use client";

import { X } from "@phosphor-icons/react";
import type { UIMessage } from "ai";
import {
  Group,
  Panel,
  Separator,
  type PanelSize,
} from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RIGHT_PANEL_BOUNDS,
  useRightPanel,
  type DeliveryKind,
  type DeliveryPayload,
} from "./right-panel-store";
import { FileViewer } from "./views/file-viewer";
import { TextViewer } from "./views/text-viewer";
import { TraceViewer } from "./views/trace-viewer";

const WIDTH_STORAGE_KEY = "chat:right-panel:width";
type DeliverPart = {
  type?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
};

/**
 * Right-panel host. Wraps the chat in a resizable panel group; when
 * the URL has `?panel=…`, a second panel mounts on the right with the
 * matching renderer (trace, file, text, or a stub for kinds we
 * haven't wired yet).
 *
 * One slot only — opening a delivery from the chat replaces an open
 * trace and vice versa. The component reads `messages` so it can
 * resolve trace + delivery payloads without any global state.
 *
 * Width persistence is local — react-resizable-panels writes the
 * pixel size into localStorage on every resize, restored on mount.
 * No store, no context.
 */
export function ChatWithRightPanel({
  agentId,
  messages,
  children,
}: {
  agentId: string;
  messages: UIMessage[];
  children: React.ReactNode;
}) {
  const { view, close } = useRightPanel();

  const initialWidth = readWidthFromStorage();

  const handleResize = (size: PanelSize) => {
    writeWidthToStorage(size.inPixels);
  };

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="chat-main" className="min-w-0">
        <div className="h-full min-h-0 min-w-0">{children}</div>
      </Panel>

      {view !== null && (
        <>
          <Separator
            id="chat-separator"
            className="group relative w-1 cursor-col-resize bg-transparent transition-colors hover:bg-foreground/10 data-[state=resizing]:bg-foreground/20"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/60" />
          </Separator>
          <Panel
            id="chat-right"
            defaultSize={`${initialWidth}px`}
            minSize={`${RIGHT_PANEL_BOUNDS.min}px`}
            maxSize={`${RIGHT_PANEL_BOUNDS.max}px`}
            onResize={handleResize}
          >
            <div className="flex h-full flex-col border-l border-border/60 bg-background">
              <PanelHeader onClose={close} />
              <div className="min-h-0 flex-1">
                <PanelBody agentId={agentId} messages={messages} />
              </div>
            </div>
          </Panel>
        </>
      )}
    </Group>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/40 px-2 py-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className={cn("h-7 w-7 p-0 text-muted-foreground hover:text-foreground")}
        aria-label="Close panel"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function PanelBody({
  agentId,
  messages,
}: {
  agentId: string;
  messages: UIMessage[];
}) {
  const { view } = useRightPanel();
  if (!view) return null;

  if (view.kind === "trace") {
    return (
      <TraceViewer
        messageId={view.payload.messageId}
        messages={messages}
        highlightToolCallId={view.payload.highlightToolCallId}
      />
    );
  }

  // Delivery: resolve payload from id alone (kind:identifier form) or
  // from a tool-Deliver part in messages whose toolCallId matches.
  const payload = resolveDeliveryPayload(view.id, messages);
  if (!payload) {
    return (
      <UnsupportedDelivery
        kind="unknown"
        title=""
        message={`Couldn't resolve delivery "${view.id}".`}
      />
    );
  }

  if (payload.kind === "file" && payload.url) {
    return <FileViewer agentId={agentId} path={payload.url} />;
  }
  if (payload.kind === "text" && typeof payload.content === "string") {
    return <TextViewer title={payload.title || "Text"} content={payload.content} />;
  }
  return <UnsupportedDelivery kind={payload.kind} title={payload.title} />;
}

/**
 * Two resolution paths, in order:
 *
 * 1. **URL-only ids** like `file:/abs/path` and `text:<urlEncoded>` —
 *    cheap, no message walk needed. Used by the legacy "View in panel"
 *    affordance on file tool cards.
 * 2. **Tool-Deliver lookup** — the id matches a `tool-Deliver` part's
 *    `toolCallId`; we read the payload off `part.input` / `part.output`.
 *    This is what the deliver tool will use once it lands.
 */
function resolveDeliveryPayload(
  id: string,
  messages: UIMessage[],
): DeliveryPayload | null {
  // Path 1: URL-encoded `kind:identifier` shortcuts.
  const colon = id.indexOf(":");
  if (colon !== -1) {
    const maybeKind = id.slice(0, colon);
    const tail = id.slice(colon + 1);
    if (maybeKind === "file" && tail) {
      return {
        id,
        kind: "file",
        title: tail.split("/").pop() ?? tail,
        url: tail,
      };
    }
    if (maybeKind === "text" && tail) {
      try {
        return {
          id,
          kind: "text",
          title: "Text",
          content: decodeURIComponent(tail),
        };
      } catch {
        /* fall through */
      }
    }
  }

  // Path 2: walk messages for a tool-Deliver part keyed by toolCallId.
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      const p = part as DeliverPart;
      if (p?.type !== "tool-Deliver") continue;
      if (p.toolCallId !== id) continue;
      const input = (p.input ?? {}) as Record<string, unknown>;
      const kind = (input.kind as DeliveryKind) ?? "text";
      return {
        id,
        kind,
        title: typeof input.title === "string" ? input.title : "",
        content: typeof input.content === "string" ? input.content : undefined,
        url: typeof input.url === "string" ? input.url : undefined,
        meta:
          input.meta && typeof input.meta === "object"
            ? (input.meta as Record<string, unknown>)
            : undefined,
      };
    }
  }
  return null;
}

function UnsupportedDelivery({
  kind,
  title,
  message,
}: {
  kind: string;
  title: string;
  message?: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border/60 px-5 py-3.5">
        <h3 className="text-sm font-medium">{title || kind}</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {message ?? (
            <>
              Preview not implemented for kind: <code>{kind}</code>
            </>
          )}
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          {message ? "" : "We'll add this delivery type next."}
        </p>
      </div>
    </div>
  );
}

function readWidthFromStorage(): number {
  if (typeof window === "undefined") return RIGHT_PANEL_BOUNDS.default;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= RIGHT_PANEL_BOUNDS.min && n <= RIGHT_PANEL_BOUNDS.max) {
      return n;
    }
  } catch {
    /* localStorage may throw in private mode */
  }
  return RIGHT_PANEL_BOUNDS.default;
}

function writeWidthToStorage(px: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}
