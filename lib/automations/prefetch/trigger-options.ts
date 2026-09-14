/**
 * Trigger type registry — client-safe.
 *
 * Defines available trigger types, their config shapes, and defaults.
 * Imported by both:
 *   - Server: prefetch engine (to know which Composio tools to call)
 *   - Client: TriggerEditor UI (to render config forms)
 *
 * No server imports here — keep this file client-safe.
 */

export type ConfigField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  default?: unknown;
  placeholder?: string;
  helpText?: string;
  /** If true, only shown when the user expands "Advanced" */
  advanced?: boolean;
};

export type TriggerOption = {
  type: string;
  label: string;
  description: string;
  icon: string;
  /** Composio toolkit slug — must be in agent's composioToolkits */
  requiredToolkit: string;
  configFields: ConfigField[];
  defaultConfig: Record<string, unknown>;
};

// ── Slack Channel Scanner ────────────────────────────────
// Special case: uses native Slack API (not Composio prefetch).
// Included here so the UI can render it alongside Composio triggers.

const SLACK_CHANNEL_SCANNER: TriggerOption = {
  type: "slack.channel_scanner",
  label: "Watch a Slack channel",
  description: "Monitor a channel for unanswered questions and jump in to help.",
  icon: "👀",
  requiredToolkit: "slack",
  configFields: [
    {
      key: "channelId",
      label: "Channel",
      type: "text", // rendered as a dropdown by the UI (special case)
      placeholder: "Select a channel",
    },
    {
      key: "cadenceHours",
      label: "Check every",
      type: "number",
      default: 6,
      helpText: "Hours between scans",
      advanced: true,
    },
    {
      key: "dwellHours",
      label: "Wait before responding",
      type: "number",
      default: 2,
      helpText: "Hours a message must sit unanswered before the agent responds",
      advanced: true,
    },
    {
      key: "classifierThreshold",
      label: "Confidence threshold",
      type: "number",
      default: 0.75,
      helpText: "0–1. Higher = fewer but more relevant responses",
      advanced: true,
    },
  ],
  defaultConfig: {
    cadenceHours: 6,
    dwellHours: 2,
    classifierThreshold: 0.75,
  },
};

// ── Gmail Inbox ──────────────────────────────────────────

const GMAIL_INBOX: TriggerOption = {
  type: "composio.gmail.inbox",
  label: "Gmail Inbox",
  description: "Fetch recent emails so the agent can summarize or triage.",
  icon: "📧",
  requiredToolkit: "gmail",
  configFields: [
    {
      key: "hoursBack",
      label: "Look back",
      type: "number",
      default: 24,
      helpText: "Hours of email history to fetch",
    },
    {
      key: "maxResults",
      label: "Max emails",
      type: "number",
      default: 20,
      helpText: "Maximum number of emails to fetch",
      advanced: true,
    },
  ],
  defaultConfig: { hoursBack: 24, maxResults: 20 },
};

// ── GitHub Activity ──────────────────────────────────────

const GITHUB_ACTIVITY: TriggerOption = {
  type: "composio.github.activity",
  label: "GitHub Activity",
  description: "Fetch open PRs and recent issues for standup summaries.",
  icon: "🐙",
  requiredToolkit: "github",
  configFields: [
    {
      key: "owner",
      label: "Owner",
      type: "text",
      placeholder: "e.g., your-org",
      helpText: "GitHub org or username",
    },
    {
      key: "repo",
      label: "Repository",
      type: "text",
      placeholder: "e.g., main-app",
    },
    {
      key: "includePRs",
      label: "Include pull requests",
      type: "boolean",
      default: true,
    },
    {
      key: "includeIssues",
      label: "Include issues",
      type: "boolean",
      default: true,
    },
  ],
  defaultConfig: { owner: "", repo: "", includePRs: true, includeIssues: true },
};

// ── Linear Issues ────────────────────────────────────────

const LINEAR_ISSUES: TriggerOption = {
  type: "composio.linear.issues",
  label: "Linear Issues",
  description: "Fetch recent issues for status updates and blocker reports.",
  icon: "📋",
  requiredToolkit: "linear",
  configFields: [
    {
      key: "maxResults",
      label: "Max issues",
      type: "number",
      default: 25,
      advanced: true,
    },
  ],
  defaultConfig: { maxResults: 25 },
};

// ── Registry ─────────────────────────────────────────────

export const TRIGGER_OPTIONS: TriggerOption[] = [
  SLACK_CHANNEL_SCANNER,
  GMAIL_INBOX,
  GITHUB_ACTIVITY,
  LINEAR_ISSUES,
];

export function getTriggerOption(type: string): TriggerOption | undefined {
  return TRIGGER_OPTIONS.find((t) => t.type === type);
}
