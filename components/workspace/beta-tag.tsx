"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Small "beta" label that sits next to the Dispatch logo in
 * `AgentIsland`. Hovering reveals the same context the old layout's
 * `SidebarBanner` carried — a one-sentence "what beta means here"
 * message plus an optional CTA link.
 *
 * Configuration mirrors the legacy `global-banner.tsx` env vars so
 * marketing/ops can tweak the message without a code change:
 *
 *   NEXT_PUBLIC_BANNER_TEXT       — tooltip body (overrides default)
 *   NEXT_PUBLIC_BANNER_LINK_TEXT  — optional CTA label
 *   NEXT_PUBLIC_BANNER_LINK_URL   — optional CTA href
 *
 * Unlike the legacy `BetaTag`, this component is NOT env-gated —
 * it renders unconditionally so the beta status is always visible
 * to early users. When we go GA, delete this component and remove
 * the import in `agent-island.tsx`.
 */

const DEFAULT_TOOLTIP_TEXT =
  "Dispatch is in active development. Things may change, break, or move around — your feedback shapes what's next.";

export function BetaTag() {
  const text = process.env.NEXT_PUBLIC_BANNER_TEXT || DEFAULT_TOOLTIP_TEXT;
  const linkText = process.env.NEXT_PUBLIC_BANNER_LINK_TEXT;
  const linkUrl = process.env.NEXT_PUBLIC_BANNER_LINK_URL;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="cursor-help rounded bg-foreground/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-describedby="beta-tag-tooltip"
            >
              beta
            </span>
          }
        />
        <TooltipContent
          id="beta-tag-tooltip"
          side="bottom"
          align="start"
          sideOffset={8}
          className="max-w-[280px] border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <p className="text-xs leading-relaxed">{text}</p>
          {linkText && linkUrl && (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-foreground underline underline-offset-2 transition-opacity hover:opacity-80"
            >
              {linkText} →
            </a>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
