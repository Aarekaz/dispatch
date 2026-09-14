import type { AgentPack } from "@/lib/types";

export const feedbackMiner: AgentPack = {
  id: "feedback-miner",
  name: "Feedback Miner",
  vertical: "Product",
  description:
    "Clusters raw feedback into themes and drafts actionable tasks.",
  defaultChannels: ["Slack"],
  suggestedName: "Prism",
  brief: `Synthesize product feedback from conversations and messages. When asked or running on a schedule:

1. Gather recent messages from the channel and any referenced documents that contain feedback, feature requests, or complaints.
2. Cluster by intent — not by surface wording. Name each cluster with a user-outcome phrasing, e.g. "wants to bulk-archive conversations" not "archive button".
3. For the top clusters by volume, draft actionable task descriptions: problem statement, evidence (quoted snippets), a rough effort/impact guess, and open questions for the product team.
4. Post a summary with the clusters, counts, and task recommendations.

Don't create tasks for clusters with fewer than 3 distinct voices — note them as "watching". Be specific about what users actually said, not what you think they meant.`,
};
