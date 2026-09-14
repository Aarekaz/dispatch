/**
 * V1 automation templates.
 *
 * These define the "New Automation" gallery — pre-configured
 * starting points that users can customize. Each template provides
 * sensible defaults for schedules, triggers, delivery, and
 * instructions so users can create a working automation in seconds.
 */

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  icon: "calendar" | "eyes" | "play";
  defaults: {
    schedules: Array<{ id: string; cron: string; timezone: string }>;
    triggers: Array<{
      id: string;
      type: string;
      label?: string;
      config: Record<string, unknown>;
    }>;
    instructions: string;
    defaultDelivery: { type: "activity_log" | "slack_channel"; config?: unknown };
  };
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "scheduled_task",
    name: "Scheduled Task",
    description:
      "Run a prompt on a schedule — daily summaries, weekly reports, periodic checks.",
    icon: "calendar",
    defaults: {
      schedules: [
        {
          id: "sch_default",
          cron: "0 9 * * 1-5",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      ],
      triggers: [],
      instructions: "",
      defaultDelivery: { type: "activity_log" },
    },
  },
  {
    id: "channel_watcher",
    name: "Watch a Slack channel",
    description:
      "Monitor a Slack channel for unanswered questions and jump in to help.",
    icon: "eyes",
    defaults: {
      schedules: [],
      triggers: [
        {
          id: "trg_scanner",
          type: "slack.channel_scanner",
          config: {
            cadenceHours: 6,
            dwellHours: 2,
            classifierThreshold: 0.75,
          },
        },
      ],
      instructions: [
        "You're reviewing an unanswered question from a Slack channel.",
        "The question has gone unanswered for 2+ hours.",
        "",
        "Rules:",
        "- Be brief and helpful",
        "- Cite specific sources (Linear tickets, docs, Notion pages)",
        "- If you can't help, stay silent — don't reply with generic advice",
        "- Never apologize for the delay",
        "- Never mention that you're an AI or an automation",
      ].join("\n"),
      defaultDelivery: { type: "activity_log" }, // scanner uses trigger-determined delivery
    },
  },
  {
    id: "email_digest",
    name: "Email Digest",
    description:
      "Daily summary of your inbox — highlights and action items, posted to Slack.",
    icon: "calendar",
    defaults: {
      schedules: [
        {
          id: "sch_default",
          cron: "0 9 * * 1-5",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      ],
      triggers: [
        {
          id: "trg_gmail",
          type: "composio.gmail.inbox",
          label: "Gmail Inbox",
          config: { hoursBack: 24, maxResults: 30 },
        },
      ],
      instructions: [
        "Summarize my recent emails. Group by sender or topic.",
        "Highlight anything that needs my response today.",
        "Use bullet points. Be concise — no filler.",
      ].join("\n"),
      defaultDelivery: { type: "activity_log" }, // user picks a Slack channel after creation
    },
  },
  {
    id: "github_standup",
    name: "GitHub Standup",
    description:
      "Daily summary of PRs, issues, and activity — ready for standup.",
    icon: "calendar",
    defaults: {
      schedules: [
        {
          id: "sch_default",
          cron: "0 9 * * 1-5",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      ],
      triggers: [
        {
          id: "trg_github",
          type: "composio.github.activity",
          label: "GitHub Activity",
          config: { owner: "", repo: "", includePRs: true, includeIssues: true },
        },
      ],
      instructions: [
        "Write a standup summary from this GitHub activity.",
        "Cover: PRs needing review, stale PRs, new issues, blockers.",
        "Keep it short — one line per item.",
      ].join("\n"),
      defaultDelivery: { type: "activity_log" }, // user picks a Slack channel after creation
    },
  },
  {
    id: "manual_runbook",
    name: "Manual Runbook",
    description:
      "Run on demand with the click of a button — ad-hoc tasks, one-off checks.",
    icon: "play",
    defaults: {
      schedules: [],
      triggers: [],
      instructions: "",
      defaultDelivery: { type: "activity_log" },
    },
  },
];
