import { cn } from "@/lib/utils";

/* ── Trigger badge ───────────────────────────────────────── */
//
// Flat pill for runs not tied to a customer-facing channel — e.g.
// cron runs or manual API triggers. Shaped like a ChannelPill but
// visually muted so it reads as "system" rather than "customer."
//
// Used on the events page and the agent management activity section.

export function TriggerBadge({
  trigger,
  className,
}: {
  trigger: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {capitalize(trigger)}
    </span>
  );
}

/* ── Shared helper ───────────────────────────────────────── */

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
