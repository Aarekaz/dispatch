"use client";

import type { ReactNode } from "react";

/**
 * Pure presentation row — used for both channels and Composio tools.
 * Keeps visual language uniform across every integration.
 *
 *   ┌────┬──────────────────────────────┬─────────────┐
 *   │ 📷 │ Name                         │ [Action]    │
 *   │    │ Description                  │             │
 *   └────┴──────────────────────────────┴─────────────┘
 *
 * The `action` slot is whatever the caller provides — a Connect button,
 * a ConnectedMenu dropdown, a dialog trigger, or a link. The row itself
 * has no opinion about the connection mechanism.
 */
export function IntegrationRow({
  logo,
  name,
  description,
  action,
}: {
  /** Logo node — img element, Lucide icon, or custom JSX. */
  logo: ReactNode;
  name: string;
  description?: string;
  /** Right-side action element (Connect button, dropdown, etc). */
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background">
        {logo}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
