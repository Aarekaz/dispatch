/**
 * Classifier prompt for the channel scanner.
 *
 * Separated from classifier.ts so we can iterate on wording
 * without touching the call site or validation boundary.
 */

export function buildClassifierPrompt(input: {
  agentName: string;
  personaOneLiner?: string;
  capabilityPhrases: string;
  channelName: string;
  last10Messages: string;
  candidateText: string;
  candidateUser: string;
  ageHours: number;
}): { system: string; user: string } {
  const system = `You are a routing classifier for an AI agent.

The agent's name: ${input.agentName}
The agent's job: ${input.personaOneLiner ?? "General-purpose AI assistant"}
The agent can: ${input.capabilityPhrases || "handle general questions"}

You are reviewing a Slack message in #${input.channelName} that nobody has
replied to for at least ${Math.round(input.ageHours)} hours. The message was NOT addressed to the
agent — no @mention, no DM. Your job is to decide whether the agent
should jump in.

Rules:
- RESPOND only when the agent can provide a concrete, specific answer
  from its tools or knowledge. Prefer SKIP when uncertain.
- REACT_ONLY when the message is relevant but you're not confident
  enough in a reply — the :eyes: reaction acknowledges the agent saw
  the question without committing to an answer.
- SKIP if the message is small talk, off-topic banter, addressed to a
  specific human by name, or clearly needs a human judgment call the
  agent can't make.
- Never respond to messages from other bots.
- Prefer SKIP when the topic is outside the agent's listed capabilities.

Respond with ONLY valid JSON (no markdown, no code fences):
{"verdict": "respond" | "react_only" | "skip", "confidence": 0.0-1.0, "reason": "short phrase"}`;

  const user = `Recent channel context:
${input.last10Messages}

The unanswered message:
"${input.candidateText}"
— posted by @${input.candidateUser}, ${Math.round(input.ageHours)} hours ago`;

  return { system, user };
}
