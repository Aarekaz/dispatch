"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Global banner system controlled by environment variables.
 *
 * Set in Vercel dashboard → Environment Variables:
 *   NEXT_PUBLIC_BANNER_TEXT        — the message (empty = hidden)
 *   NEXT_PUBLIC_BANNER_TYPE        — info | warning | error | announcement
 *   NEXT_PUBLIC_BANNER_DISMISSIBLE — true | false
 *   NEXT_PUBLIC_BANNER_LINK_TEXT   — optional CTA text
 *   NEXT_PUBLIC_BANNER_LINK_URL    — optional CTA URL
 *
 * Layout:
 *   - "error" type → full-width top banner (visible on every page)
 *   - "info" / "warning" / "announcement" → sidebar card
 *   - Beta tag next to logo → controlled by NEXT_PUBLIC_BANNER_TYPE=info
 */

type BannerType = "info" | "warning" | "error" | "announcement";

function getBannerConfig() {
  const text = process.env.NEXT_PUBLIC_BANNER_TEXT;
  if (!text) return null;
  return {
    text,
    type: (process.env.NEXT_PUBLIC_BANNER_TYPE as BannerType) || "info",
    dismissible: process.env.NEXT_PUBLIC_BANNER_DISMISSIBLE === "true",
    linkText: process.env.NEXT_PUBLIC_BANNER_LINK_TEXT,
    linkUrl: process.env.NEXT_PUBLIC_BANNER_LINK_URL,
  };
}

// ── Top banner — only for outages (error type) ──────────

export function GlobalBanner() {
  const config = getBannerConfig();
  if (!config || config.type !== "error") return null;

  return (
    <DismissibleBanner
      text={config.text}
      label="Outage"
      dismissible={config.dismissible}
      linkText={config.linkText}
      linkUrl={config.linkUrl}
      className="bg-destructive/10 text-destructive"
    />
  );
}

// ── Sidebar card — for info/warning/announcement ────────

const SIDEBAR_STYLE: Record<string, string> = {
  info: "border-sidebar-border/50 bg-sidebar-accent/30 text-sidebar-fg",
  warning: "border-warning/20 bg-warning-subtle text-warning-foreground",
  announcement: "border-sidebar-border/50 bg-sidebar-accent/30 text-sidebar-fg",
};

const SIDEBAR_LABEL: Record<string, string> = {
  info: "Beta",
  warning: "Warning",
  announcement: "New",
};

export function SidebarBanner() {
  const config = getBannerConfig();
  if (!config || config.type === "error") return null;

  return (
    <SidebarBannerInner
      text={config.text}
      type={config.type}
      dismissible={config.dismissible}
      linkText={config.linkText}
      linkUrl={config.linkUrl}
    />
  );
}

function SidebarBannerInner({
  text,
  type,
  dismissible,
  linkText,
  linkUrl,
}: {
  text: string;
  type: BannerType;
  dismissible: boolean;
  linkText?: string;
  linkUrl?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className={cn(
        "relative rounded-lg border px-3 py-2.5",
        SIDEBAR_STYLE[type] ?? SIDEBAR_STYLE.info,
      )}
    >
      <p className="text-[11px] leading-relaxed">
        <span className="font-semibold">{SIDEBAR_LABEL[type] ?? type}</span>
        <span className="mx-1 opacity-30">—</span>
        {text}
        {linkText && linkUrl && (
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 underline underline-offset-2 opacity-70 transition-opacity hover:opacity-100"
          >
            {linkText}
          </a>
        )}
      </p>
      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 opacity-30 transition-opacity hover:opacity-70"
          aria-label="Dismiss"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ── Beta tag — small label next to the logo ─────────────

export function BetaTag() {
  const config = getBannerConfig();
  if (!config || config.type !== "info") return null;

  return (
    <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      beta
    </span>
  );
}

// ── Shared dismissible top banner ───────────────────────

function DismissibleBanner({
  text,
  label,
  dismissible,
  linkText,
  linkUrl,
  className,
}: {
  text: string;
  label: string;
  dismissible: boolean;
  linkText?: string;
  linkUrl?: string;
  className: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className={cn(
        "relative flex min-h-9 items-center justify-center gap-2 px-4 py-2 text-center text-xs",
        className,
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className="opacity-40">—</span>
      <span>{text}</span>

      {linkText && linkUrl && (
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
        >
          {linkText}
        </a>
      )}

      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 transition-opacity hover:opacity-80"
          aria-label="Dismiss banner"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
