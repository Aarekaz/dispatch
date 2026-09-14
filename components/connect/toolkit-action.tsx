"use client";

import { useState } from "react";
import { sileo } from "sileo";
import { CaretDown, Check, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/unicode-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  openComposioPopup,
  watchComposioAuthFlow,
} from "@/lib/composio/auth-popup";
import type { ConnectionStatus } from "@/hooks/use-composio-toolkits";

/**
 * Composio toolkit action — renders a single Connect button when
 * disconnected, or a ConnectedMenu dropdown when connected.
 *
 * Connecting a toolkit atomically:
 *   1. Ensures the slug is in `composioToolkits` on the agent record
 *   2. Fetches a connect URL from `/api/composio/connect`
 *   3. Opens OAuth popup and polls for completion
 *   4. Refreshes the connection status map
 *
 * One click = both enable + connect. No separate "save" step.
 */
export function ToolkitAction({
  agentId,
  slug,
  name,
  status,
  onChanged,
}: {
  agentId: string;
  slug: string;
  name: string;
  status: ConnectionStatus | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  function connect() {
    // Open the OAuth popup SYNCHRONOUSLY inside the click handler.
    // The PATCH below can take 3-5s (warm sandbox rebuild) and the
    // connect POST adds more — if we `window.open`'d after those
    // awaits, browsers would consider the user gesture stale and
    // block the popup. By opening an about:blank placeholder now and
    // navigating it to the real URL once we have it, we keep
    // transient-activation inside the one-click path every browser
    // allows.
    const popup = openComposioPopup();
    if (!popup) {
      sileo.error({
        title: `Couldn't connect ${name}`,
        description:
          "Popup blocked by your browser. Allow popups for this site and try again.",
      });
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        // Use the incremental `toolkitAdd` op instead of a client-
        // computed full array. Two concurrent Connect clicks on
        // different toolkits used to each PATCH a full list built
        // from the same stale client snapshot — whichever commit
        // landed second silently dropped the other's slug. The
        // server now reads current state inside the Convex
        // transaction and merges set-style, so order doesn't matter.
        const patchRes = await fetch(`/api/agents/${agentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolkitAdd: slug }),
        });
        if (!patchRes.ok) {
          const data = await patchRes.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${patchRes.status}`);
        }

        if (popup.closed) {
          // User closed the placeholder popup mid-await — treat as
          // cancellation, leave the toolkit enabled (the next Connect
          // click will skip the PATCH and be fast).
          sileo.info({ title: "Connection cancelled" });
          return;
        }

        const res = await fetch("/api/composio/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, toolkit: slug }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        if (data.redirectUrl) {
          // Navigate the popup + watch for completion. Resolve = success;
          // reject on explicit error or popup-closed. We branch the
          // cancellation message into an info toast instead of red.
          try {
            await watchComposioAuthFlow(popup, data.redirectUrl);
            sileo.success({ title: `Connected ${name}` });
            onChanged();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "Popup closed before completion") {
              sileo.info({ title: "Connection cancelled" });
            } else {
              throw err;
            }
          }
        } else {
          // No OAuth needed — the connect endpoint already finalized
          // the connection. Close the placeholder popup we opened.
          popup.close();
          sileo.success({ title: `Connected ${name}` });
          onChanged();
        }
      } catch (err) {
        if (!popup.closed) popup.close();
        sileo.error({
          title: `Couldn't connect ${name}`,
          description: err instanceof Error ? err.message : "Try again",
        });
      } finally {
        setBusy(false);
      }
    })();
  }

  async function disconnect() {
    setBusy(true);
    try {
      if (status?.connectionId) {
        // The route takes (agentId, toolkit) — NOT connectionId — and
        // re-derives the active connection server-side as a security
        // measure (see app/api/composio/disconnect/route.ts docstring).
        // Sending connectionId returns HTTP 400.
        const res = await fetch("/api/composio/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            toolkit: slug,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
      }

      // Remove via the atomic incremental op — see connect() for the
      // rationale. Mirror of toolkitAdd.
      const patchRes = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitRemove: slug }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${patchRes.status}`);
      }

      sileo.success({ title: `Disconnected ${name}` });
      onChanged();
    } catch (err) {
      sileo.error({
        title: `Couldn't disconnect ${name}`,
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setBusy(false);
    }
  }

  const isConnected = status?.status === "connected";

  if (busy) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Spinner context="button" className="text-[10px]" />
        {isConnected ? "Disconnecting…" : "Connecting…"}
      </Button>
    );
  }

  if (isConnected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Check className="size-3.5 text-success" />
              <span className="max-w-[140px] truncate">
                {status?.accountLabel ?? "Connected"}
              </span>
              <CaretDown className="size-3 text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={disconnect}
            className="text-destructive focus:text-destructive"
          >
            <X className="size-3.5" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={connect}>
      Connect
    </Button>
  );
}
