import { ChannelIcon } from "@/components/ui/channel-icon";
import { channelLabel } from "@/lib/channels";
import { cn } from "@/lib/utils";

/* ── Channel pill ─────────────────────────────────────────── */
//
// Small pill that names a channel a worker is connected to. Used
// inline in activity rows, agent rows, agent-management channel
// list, settings, and the empty-state ghost cards. Single source of
// truth — editing this file updates every channel affordance.
//
// The pill pairs a brand-colored icon with a text label. Icons use
// official brand colors (Slack aubergine, Telegram blue, etc.) for
// instant visual scanning. The label stays in `text-muted-foreground`.
//
// See `channel-icon.tsx` for path definitions, brand colors, and
// licensing provenance.

type ChannelPillSize = "default" | "xs";

// Both sizes use the same `text-xs` token from the type scale.
// The size variants differ in horizontal padding and icon/label gap,
// creating a subtle density distinction without introducing off-scale
// font sizes. `gap-1.5` on default pairs well with `size-3` (12px)
// icons; `gap-1` on xs keeps the tighter row alignment on agent rows.
const SIZE_CLASSES: Record<ChannelPillSize, string> = {
  default: "gap-1.5 px-2 py-0.5 text-xs",
  xs: "gap-1 px-1.5 py-0.5 text-xs",
};

export function ChannelPill({
  channel,
  size = "default",
  className,
}: {
  channel: string;
  size?: ChannelPillSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border bg-background font-medium text-muted-foreground",
        SIZE_CLASSES[size],
        className,
      )}
    >
      <ChannelIcon channel={channel} />
      {channelLabel(channel)}
    </span>
  );
}
