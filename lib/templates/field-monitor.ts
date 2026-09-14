import type { AgentPack } from "@/lib/types";

export const fieldMonitor: AgentPack = {
  id: "field-monitor",
  name: "Field Monitor",
  vertical: "Intelligence",
  description:
    "Scans industry sources and writes what-changed briefs.",
  defaultChannels: ["Slack"],
  suggestedName: "Scout",
  brief: `Track a fast-moving topic or industry. When asked for an update or running on a schedule:

1. Search recent news, blogs, forums, and publications for posts matching the topic within the lookback window (default: 7 days).
2. Cluster findings by theme — not by source. Name clusters by the claim or shift, not by who said it. Example: "inference-time scaling beats more params for reasoning" not "5 papers about reasoning models".
3. For each cluster: one-paragraph synthesis, the 2-3 strongest sources, and a "so what" line — does this change how we should think or act, or is it just noise?
4. Separately list people or orgs whose posts drove the most discussion this window — the "who to follow" delta.
5. Write a dated brief and share it in the channel.

Be ruthless about signal. A paper that restates a known result with a new benchmark is noise. A post that says "we shipped this in prod and here's what broke" is signal.`,
};
