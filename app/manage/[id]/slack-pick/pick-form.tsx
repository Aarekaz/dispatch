"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sileo } from "sileo";

import type { SlackChannel } from "./page";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BOT_MENTION_HANDLE } from "@/lib/config/branding";
import { cn } from "@/lib/utils";

/**
 * Client form for the Slack pick page.
 *
 * Three states:
 *   - "workspace": agent responds anywhere `@Dispatch` is mentioned
 *     in this Slack workspace. One row, channelBinding=`team:<id>`.
 *   - "channels": agent responds only in selected channels. N rows,
 *     each channelBinding=`chan:<id>`.
 *   - submitting: form posts to /api/agents/[id]/slack/bind, the
 *     button shows a loading state, errors render inline.
 *
 * **Best practices applied:**
 *   - Local component state via `useState` only — no `useEffect`
 *     for side effects (per CLAUDE.md `no-use-effect`).
 *   - All interactivity is purely derived state (`scope` toggles
 *     show/hide of the channel list; `selectedChannelIds` toggles
 *     by ID).
 *   - Form validation happens before the network call (must pick
 *     at least one channel if scope=channels).
 *   - Error messages are plain English, no enthusiasm theater
 *     (per .impeccable.md).
 *   - Native HTML radio inputs styled with Tailwind — fewer
 *     dependencies than radix-ui RadioGroup, same a11y.
 */
export function SlackPickForm({
  agentId,
  agentName,
  teamId,
  channels,
}: {
  agentId: string;
  agentName: string;
  teamId: string;
  channels: SlackChannel[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"workspace" | "channels">("workspace");
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleChannel(id: string) {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (scope === "channels" && selectedChannelIds.size === 0) {
      setError("Pick at least one channel, or choose 'Anywhere' instead.");
      return;
    }

    setSubmitting(true);

    const promise = (async () => {
      const body =
        scope === "workspace"
          ? { scope: "workspace" as const, teamId }
          : {
              scope: "channels" as const,
              teamId,
              channelIds: Array.from(selectedChannelIds),
            };

      const res = await fetch(`/api/agents/${agentId}/slack/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `Couldn't save (HTTP ${res.status})`);
      }

      // Success — back to the agent's workspace settings. The legacy
      // ?slackBound=1 flag is dropped: it used to be read by the
      // old AgentManagePage to show a post-connect toast, but that
      // page has since been deleted.
      router.push(`/${agentId}/settings`);
      router.refresh();
    })();

    sileo.promise(promise, {
      loading: { title: "Connecting channel…", duration: null },
      success: { title: "Channel connected" },
      error: (err) => ({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
      }),
    });

    promise.catch((err) => {
      setError(err instanceof Error ? err.message : "Couldn't save binding");
    }).finally(() => setSubmitting(false));
  }

  return (
    <form onSubmit={onSubmit} className="mt-12 space-y-10">
      {/* ── Scope selector ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium tracking-tight text-foreground">
          Where should {agentName} respond?
        </legend>

        <ScopeOption
          checked={scope === "workspace"}
          onChange={() => setScope("workspace")}
          title="Anywhere in this workspace"
          description={`${agentName} will reply whenever ${BOT_MENTION_HANDLE} is mentioned in any channel of this Slack. Best for executive assistants and general-purpose helpers.`}
        />

        <ScopeOption
          checked={scope === "channels"}
          onChange={() => setScope("channels")}
          title="Only in specific channels"
          description={`${agentName} will reply only when ${BOT_MENTION_HANDLE} is mentioned in the channels you pick below. Best for support, sales, and ops bots with a focused job.`}
        />
      </fieldset>

      {/* ── Channel list (only when scope = channels) ── */}
      {scope === "channels" && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium tracking-tight text-foreground">
            Channels ({selectedChannelIds.size} selected)
          </legend>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels found. Make sure your Slack workspace has at least
              one public channel.
            </p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border border-border">
              {channels.map((channel) => {
                const checked = selectedChannelIds.has(channel.id);
                return (
                  <label
                    key={channel.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0",
                      "hover:bg-muted/30",
                      checked && "bg-muted/20",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChannel(channel.id)}
                      className="size-4 rounded border-border accent-foreground"
                    />
                    <span className="text-foreground">#{channel.name}</span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            You&apos;ll need to invite {BOT_MENTION_HANDLE} to each of these
            channels in Slack — type{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              /invite {BOT_MENTION_HANDLE}
            </code>{" "}
            in the channel.
          </p>
        </fieldset>
      )}

      {/* ── Submit + error ── */}
      <div className="space-y-3">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Saving…"
            : `Save and connect ${agentName}`}
        </Button>
      </div>
    </form>
  );
}

/* ── Scope option (single radio with rich description) ────── */

function ScopeOption({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <Label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border border-border p-4",
        "hover:bg-muted/30",
        checked && "border-foreground/40 bg-muted/20",
      )}
    >
      <input
        type="radio"
        name="scope"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 accent-foreground"
      />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </Label>
  );
}
