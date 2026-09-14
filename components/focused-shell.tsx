"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "@phosphor-icons/react";

import { BetaTag } from "@/components/workspace/beta-tag";
import { Button } from "@/components/ui/button";

/**
 * Shell for pages that live OUTSIDE any single agent's context —
 * creation flows ("new agent"), account-level settings (billing,
 * profile, personalization). These are "focused" states: the user
 * is doing one thing, not navigating a workspace.
 *
 * Design deliberately strips the workspace chrome. No dock (the dock
 * is agent-scoped — there's no active agent here). No sandbox pill
 * (same). No agent switcher (would be noise in a wizard). Just the
 * Dispatch wordmark as a way back to the app, a close affordance, and
 * the content.
 *
 * Close returns to wherever the user came from if we have history,
 * otherwise to the app entrypoint (which redirects to their first agent's home).
 */
export function FocusedShell({ children }: { children: ReactNode }) {
  const router = useRouter();

  function close() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/app");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link
          href="/app"
          aria-label="Dispatch"
          className="flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wordmark.svg"
            alt="Dispatch"
            className="h-6 w-auto dark:invert"
          />
          <BetaTag />
        </Link>

        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
          <span className="sr-only sm:not-sr-only">Close</span>
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
