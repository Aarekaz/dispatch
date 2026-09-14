"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";
import { CaretDown, Check, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/unicode-spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Channel action — renders the correct connect/disconnect flow
 * for each supported channel. Three flows exist today:
 *
 *   • Link-based OAuth (Slack): `<Link>` to install URL, server
 *     redirects back after grant
 *   • Dialog-based paste-token (Telegram): open a modal, paste
 *     bot token, POST to connect
 *   • Coming soon (WhatsApp, Email, Discord): disabled button
 *
 * When connected, shows a dropdown with account label + disconnect.
 */
export type ChannelSpec = {
  key: string;
  installPath?: string;
  dialogConnect?: boolean;
};

export const CHANNEL_SPECS: Record<string, ChannelSpec> = {
  slack: { key: "slack", installPath: "/api/slack/install" },
  telegram: { key: "telegram", dialogConnect: true },
  whatsapp: { key: "whatsapp" },
  email: { key: "email" },
  discord: { key: "discord" },
};

export function ChannelAction({
  agentId,
  channelKey,
  label,
  connected,
  channelBinding,
}: {
  agentId: string;
  channelKey: string;
  label: string;
  connected: boolean;
  channelBinding?: string;
}) {
  const spec = CHANNEL_SPECS[channelKey];

  if (!spec) {
    return (
      <Button variant="outline" size="sm" disabled>
        Coming soon
      </Button>
    );
  }

  if (connected) {
    return (
      <ChannelConnectedMenu
        agentId={agentId}
        channelKey={channelKey}
        label={label}
        channelBinding={channelBinding}
        spec={spec}
      />
    );
  }

  if (spec.installPath) {
    return (
      <Button
        variant="outline"
        size="sm"
        render={
          <Link href={`${spec.installPath}?agentId=${agentId}` as Route} />
        }
      >
        Connect
      </Button>
    );
  }

  if (spec.dialogConnect) {
    return <TelegramConnect agentId={agentId} label={label} />;
  }

  return (
    <Button variant="outline" size="sm" disabled>
      Coming soon
    </Button>
  );
}

/* ── Connected state (all channels) ── */

function ChannelConnectedMenu({
  agentId,
  channelKey,
  label,
  channelBinding,
  spec,
}: {
  agentId: string;
  channelKey: string;
  label: string;
  channelBinding?: string;
  spec: ChannelSpec;
}) {
  const router = useRouter();

  // Telegram bot handles show up as `tg:@botname`
  const accountLabel =
    channelKey === "telegram" && channelBinding?.startsWith("tg:@")
      ? channelBinding.slice(3)
      : channelBinding || "Connected";

  async function disconnect() {
    sileo.action({
      title: `Disconnect ${label}?`,
      description: `Your agent will stop receiving messages on ${label}.`,
      duration: null,
      button: {
        title: "Disconnect",
        onClick: async () => {
          const endpoint = endpointForChannel(channelKey);
          if (!endpoint) {
            sileo.error({ title: "Can't disconnect this channel yet" });
            return;
          }
          const promise = fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error ?? `HTTP ${res.status}`);
            }
          });

          sileo.promise(promise, {
            loading: { title: `Disconnecting ${label}…` },
            success: { title: `Disconnected ${label}` },
            error: (err) => ({
              title: `Couldn't disconnect ${label}`,
              description:
                err instanceof Error ? err.message : "Try again.",
            }),
          });

          try {
            await promise;
            router.refresh();
          } catch {
            // handled by sileo.promise
          }
        },
      },
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <Check className="size-3.5 text-success" />
            <span className="max-w-[140px] truncate">{accountLabel}</span>
            <CaretDown className="size-3 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {spec.installPath && (
          <DropdownMenuItem
            render={
              <Link href={`${spec.installPath}?agentId=${agentId}` as Route}>
                Reconnect
              </Link>
            }
          />
        )}
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

function endpointForChannel(channelKey: string): string | null {
  switch (channelKey) {
    case "telegram":
      return "/api/telegram/disconnect";
    case "slack":
      return "/api/slack/disconnect";
    default:
      return null;
  }
}

/* ── Telegram dialog ── */

function TelegramConnect({
  agentId,
  label,
}: {
  agentId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const router = useRouter();

  async function handleConnect() {
    if (!botToken.trim()) return;
    setConnecting(true);
    const promise = fetch("/api/telegram/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, botToken: botToken.trim() }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      return data;
    });

    sileo.promise(promise, {
      loading: {
        title: "Connecting to Telegram",
        description: "Validating bot token and registering webhook…",
      },
      success: (data) => ({
        title: `Connected @${data.botUsername}`,
        description: "Your agent is now reachable on Telegram.",
      }),
      error: (err) => ({
        title: "Failed to connect",
        description: err instanceof Error ? err.message : "Please try again.",
      }),
    });

    try {
      await promise;
      setBotToken("");
      setOpen(false);
      router.refresh();
    } catch {
      // handled by sileo.promise
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Connect
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {label}</DialogTitle>
          <DialogDescription>
            Create a bot with{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              @BotFather
            </a>{" "}
            on Telegram, then paste the bot token below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="123456:ABC-DEF…"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && botToken.trim()) handleConnect();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            onClick={handleConnect}
            disabled={!botToken.trim() || connecting}
            size="sm"
          >
            {connecting && <Spinner context="button" className="text-[10px]" />}
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
