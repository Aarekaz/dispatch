/* ── Channel types & display labels ──────────────────────── */
//
// Single source of truth for what a "channel" is in the UI layer.
// The backend stores channel keys as lowercase strings on agent records.
// Display labels are normalized (proper nouns capitalized, brand spelling preserved).

export type Channel =
  | "web"
  | "slack"
  | "whatsapp"
  | "telegram"
  | "email"
  | "discord";

const CHANNEL_LABELS: Record<Channel, string> = {
  web: "Web",
  slack: "Slack",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
  discord: "Discord",
};

/**
 * Returns a display-friendly label for a channel key.
 * Falls back to a capitalized version of the input for unknown channels
 * (e.g. future custom integrations).
 */
export function channelLabel(channel: string): string {
  if (channel in CHANNEL_LABELS) {
    return CHANNEL_LABELS[channel as Channel];
  }
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}
