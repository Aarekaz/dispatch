import { getPresetPermissions } from "@/lib/config/tool-permissions";

/**
 * Configuration for rendering AGENTS.md — the agent's system prompt
 * file. This is the DEFINITIVE source of truth for what the agent
 * knows about itself and its environment.
 *
 * Regenerated whenever: agent created, persona changed, model changed,
 * tools added/removed, channels connected/disconnected.
 */
export type AgentsMdConfig = {
  name: string;
  model: string;
  vertical: string;
  persona?: string;
  toolPermissions?: string;
  /** Composio toolkit slugs currently enabled (e.g. ["gmail","linear","slack"]) */
  composioToolkits?: string[];
  /** Channel platforms the agent is connected to (e.g. ["web","slack","telegram"]) */
  channels?: string[];
  /** User-level context injected into every agent. Set from the
   *  Settings → Personalization page, shared across all agents. */
  userContext?: {
    company?: string;
    industry?: string;
    background?: string;
    customInstructions?: string;
  };
};

/**
 * Render the AGENTS.md file — the agent's complete system prompt on disk.
 *
 * This file is MACHINE-GENERATED. The agent reads it but never edits it.
 * When the user changes config (tools, persona, model), we regenerate it.
 *
 * The agent's own learnings go in memories/MEMORY.md (separate).
 */
export function renderAgentsMd(config: AgentsMdConfig): string {
  const permissions = getPresetPermissions(config.toolPermissions);
  const toolsYaml = Object.entries(permissions)
    .map(([tool, level]) => `  ${tool}: ${level}`)
    .join("\n");

  const persona = config.persona || defaultPersona(config);
  const userContextSection = renderUserContextSection(config.userContext);
  const toolkitSection = renderToolkitsSection(config.composioToolkits);
  const channelSection = renderChannelsSection(config.channels);

  return `---
name: ${config.name}
model: ${config.model}
temperature: 0.7
maxSteps: 25
tools:
${toolsYaml}
---

${persona}

${userContextSection}

${toolkitSection}

${channelSection}

## Your Workspace

Your working directory is \`~/agent/\`. Key locations:

- \`~/agent/workspace/\` — for files you create during tasks
- \`~/agent/knowledge/\` — reference documents uploaded by the user (read-only for you)
- \`~/agent/memories/\` — your persistent memory (see below)
- \`~/agent/AGENTS.md\` — this file (your configuration — do not edit)

## Memory

You have a persistent memory system at \`~/agent/memories/\`.

- **\`memories/MEMORY.md\`** is your memory index. Read it at the start of every significant task.
- **ALWAYS save to memory when:**
  - The user says "remember", "save this", "note this", or similar
  - You learn a user preference, team fact, or naming convention
  - You discover an integration detail or recurring pattern
  - You complete a significant task (save a one-line summary)
- Write to an appropriate file in \`memories/\` and update \`MEMORY.md\` to point to it.
- Keep each memory file focused on one topic. Keep entries concise.
- Update existing entries rather than duplicating. Remove outdated information.
- After each conversation, briefly consider: did I learn anything worth saving?
- Never mention the memory system to users. Just use it to be more helpful over time.

## Behavior

- Your replies are delivered automatically to whatever channel the user is on (web, Slack, Telegram). Never call a tool to "send a reply" or "post a message back" — just write your response.
- When using external tools, only use toolkits listed above. Do not try to use tools from toolkits not in your list.
- Be direct and concise. No filler words, no enthusiasm theater.
`;
}

/**
 * Render the initial MEMORY.md that gets seeded into a new agent's
 * memories/ directory. The agent takes ownership from here.
 */
export function renderInitialMemoryMd(agentName: string): string {
  return `# Memory

${agentName}'s persistent memory. Updated automatically as you learn.

## Index

No memories yet. As you learn about this workspace — team members, preferences, tools, patterns — create files here and add entries below.

<!-- Example entries:
- [Team structure](team.md) — who does what
- [Preferences](preferences.md) — how the team likes things done
- [Linear workspace](linear.md) — project structure, conventions
-->
`;
}

// ── Helpers ──────────────────────────────────────────────

function renderUserContextSection(ctx?: AgentsMdConfig["userContext"]): string {
  if (!ctx) return "";
  const hasProfile = ctx.company || ctx.industry;
  const hasInstructions = ctx.background || ctx.customInstructions;
  if (!hasProfile && !hasInstructions) return "";

  const parts: string[] = [];

  if (hasProfile) {
    parts.push("## Company Context\n");
    if (ctx.company) parts.push(`- **Company:** ${ctx.company}`);
    if (ctx.industry) parts.push(`- **Industry:** ${ctx.industry}`);
  }

  if (ctx.background) {
    parts.push(`\n## About Your User\n\n${ctx.background}`);
  }

  if (ctx.customInstructions) {
    parts.push(`\n## Custom Instructions\n\n${ctx.customInstructions}`);
  }

  return parts.join("\n");
}

function defaultPersona(config: AgentsMdConfig): string {
  return `You are ${config.name}, an AI agent specializing in ${config.vertical}.

## What You Do
- Handle tasks related to ${config.vertical}
- Follow instructions precisely
- Ask for clarification when needed

## How You Work
- Be proactive and thorough
- Confirm before taking irreversible actions
- Reference your memory before starting new tasks`;
}

/**
 * Per-toolkit descriptions following Composio's field guide:
 * "Tool to <what it does>. Use when <specific situation>."
 *
 * These help the agent understand WHAT each toolkit does and WHEN
 * to use it, instead of just seeing a slug name. The guide showed
 * that vague descriptions are the #1 cause of tool invocation errors.
 */
const TOOLKIT_DESCRIPTIONS: Record<string, string> = {
  gmail: "Send, read, and search emails. Use when asked to handle email tasks.",
  slack: "Read channel history and search messages. Use when asked about Slack conversations or team messages. Your replies are delivered automatically — these tools are for READING only.",
  linear: "Create, search, and update issues and projects. Use when asked about project tracking, bugs, or task management.",
  github: "Manage repositories, pull requests, and issues. Use when asked about code, PRs, or GitHub activity.",
  notion: "Read and update Notion pages and databases. Use when asked about documentation or knowledge bases.",
  hubspot: "Manage contacts, deals, and CRM records. Use when asked about sales, customers, or pipeline.",
  hackernews: "Search and read Hacker News posts and comments. Use when asked about tech news or trends.",
  googlecalendar: "Create, read, and manage calendar events. Use when asked about scheduling or meetings.",
  googledrive: "Upload, download, and manage files. Use when asked about shared documents or file storage.",
  intercom: "Read and respond to customer conversations. Use when asked about support tickets or customer messages.",
  jira: "Manage issues and projects. Use when asked about Jira tickets or sprints.",
  zendesk: "Handle support tickets and customer requests. Use when asked about helpdesk or support.",
  composio_search: "Search the web for information. Use when asked to look up current information online.",
  convex: "Query and manage the application database. Use when asked about stored data or records.",
};

function renderToolkitsSection(toolkits?: string[]): string {
  if (!toolkits || toolkits.length === 0) {
    return `## External Tools

No external tools connected. You can use bash, file I/O, and your development environment.`;
  }

  const lines = toolkits.map((t) => {
    const desc = TOOLKIT_DESCRIPTIONS[t.toLowerCase()];
    return desc ? `- **${t}** — ${desc}` : `- **${t}**`;
  });

  // Per-toolkit usage examples used to be baked in here, but that
  // didn't scale: we shipped examples for 8 toolkits out of Composio's
  // 1000+, paid ~100 tokens per enabled toolkit on every turn, and
  // had to manually update examples whenever Composio added or renamed
  // an action. The agent already has `composio_COMPOSIO_GET_TOOL_SCHEMAS`
  // — a tool-native discovery primitive that returns canonical, always-
  // current schemas on demand. Using that means we get coverage for
  // every toolkit automatically and only pay the schema cost on turns
  // that actually touch the toolkit.
  return `## External Tools

You have access to these external app integrations via Composio:
${lines.join("\n")}

Use the composio meta-tools to discover and run actions within these toolkits:
- \`composio_COMPOSIO_SEARCH_TOOLS\` to find the right action when you don't know the exact name
- \`composio_COMPOSIO_GET_TOOL_SCHEMAS\` to fetch parameter schemas — ALWAYS call this before invoking a tool you haven't used this session
- \`composio_COMPOSIO_MULTI_EXECUTE_TOOL\` to run an action

Only use tools from the toolkits listed above. Others will be blocked by session restrictions.`;
}

function renderChannelsSection(channels?: string[]): string {
  if (!channels || channels.length === 0) {
    return `## Channels

Connected to: web chat only.`;
  }

  const formatted = channels.map((c) => {
    switch (c) {
      case "web": return "Web chat";
      case "slack": return "Slack";
      case "telegram": return "Telegram";
      case "discord": return "Discord";
      case "email": return "Email";
      default: return c;
    }
  });

  return `## Channels

You are reachable on: ${formatted.join(", ")}. Your replies are delivered to the channel the user is on automatically.`;
}
