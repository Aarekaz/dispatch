"use client";

import { useQueryState } from "nuqs";
import { useCallback, useMemo } from "react";

/**
 * Right-panel state — URL-only.
 *
 * The chat area carries one openable panel at a time: a process
 * trace from a milestone group, or a deliverable from `tool-Deliver`.
 * The single source of truth is the `?panel=` search param via nuqs.
 *
 * URL grammar:
 *   ?panel=trace:<messageId>
 *   ?panel=delivery:<deliveryId>
 *   (omitted)            → closed
 *
 * The URL only carries an id. Full payloads are looked up from the
 * live `messages` array by the panel host — for traces, by message
 * id; for deliveries, by walking each message's `tool-Deliver` parts
 * for a matching `toolCallId` or payload id.
 */

export type DeliveryKind =
  | "text"
  | "file"
  | "presentation"
  | "webapp"
  | "video"
  | "image"
  | "dashboard";

export type DeliveryPayload = {
  id: string;
  kind: DeliveryKind;
  title: string;
  /** Inline content for text deliveries. */
  content?: string;
  /** Path/URL for file or webapp/video/image deliveries. */
  url?: string;
  meta?: Record<string, unknown>;
};

export type TracePayload = {
  messageId: string;
  highlightToolCallId?: string;
};

export type RightPanelView =
  | { kind: "trace"; payload: TracePayload }
  | { kind: "delivery"; id: string }
  | null;

/**
 * Read + write the right panel from the URL via nuqs. Returns a
 * tagged-union view plus a small set of openers/closers. The view
 * carries only what the URL carries — for delivery the id, for
 * trace the message id (+ optional highlight). The host resolves
 * full payloads from messages.
 */
export function useRightPanel() {
  const [token, setToken] = useQueryState("panel", {
    history: "replace",
    clearOnDefault: true,
    shallow: true,
  });

  const view = useMemo<RightPanelView>(() => parseToken(token), [token]);

  const openTrace = useCallback(
    (payload: TracePayload) => {
      const t = `trace:${payload.messageId}${
        payload.highlightToolCallId ? `@${payload.highlightToolCallId}` : ""
      }`;
      void setToken(t);
    },
    [setToken],
  );

  const openDelivery = useCallback(
    (id: string) => {
      void setToken(`delivery:${id}`);
    },
    [setToken],
  );

  const close = useCallback(() => {
    void setToken(null);
  }, [setToken]);

  return { view, openTrace, openDelivery, close };
}

function parseToken(token: string | null): RightPanelView {
  if (!token) return null;
  const colon = token.indexOf(":");
  if (colon === -1) return null;
  const kind = token.slice(0, colon);
  const tail = token.slice(colon + 1);
  if (!tail) return null;
  if (kind === "trace") {
    const at = tail.indexOf("@");
    if (at === -1) {
      return { kind: "trace", payload: { messageId: tail } };
    }
    return {
      kind: "trace",
      payload: {
        messageId: tail.slice(0, at),
        highlightToolCallId: tail.slice(at + 1) || undefined,
      },
    };
  }
  if (kind === "delivery") return { kind: "delivery", id: tail };
  return null;
}

/** Constants for the host's resize bounds. */
export const RIGHT_PANEL_BOUNDS = {
  default: 480,
  min: 320,
  max: 960,
};
