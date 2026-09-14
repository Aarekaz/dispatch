import { BOT_NAME } from "@/lib/config/branding";

/**
 * Build the App Home view (Slack `views.publish` payload).
 *
 * The App Home tab is what Slack users see when they click the bot
 * in the Apps section of the sidebar and select the "Home" tab.
 * It's a persistent, dashboard-like surface that doesn't disappear
 * like a message — making it a good place for:
 *
 *   - Branded "what this bot does" explanation
 *   - Quick-action buttons (once we add interactive Cards in Phase 2)
 *   - Agent status / recent activity summaries (Phase 2+)
 *
 * Published on `onAppHomeOpened` via `slackAdapter.publishHomeView()`.
 *
 * **Why Block Kit JSON instead of Chat SDK JSX Cards**: `publishHomeView`
 * is a Slack-specific adapter method that takes Slack's Block Kit
 * JSON directly. Chat SDK's Card components are for `thread.post()`
 * where the SDK handles cross-platform rendering. App Home views
 * are inherently Slack-only, so there's nothing to normalize.
 */
export function buildHomeView(): Record<string, unknown> {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${BOT_NAME}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hi! I'm an AI agent running on *Dispatch*. Here's how to work with me:`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `• *Invite me to a channel* with \`/invite @${BOT_NAME}\`\n` +
            `• *@-mention me* anywhere to start a conversation\n` +
            `• *Send me a DM* from the Messages tab for private work\n` +
            `• Use the *assistant panel* (side panel) for a focused workspace`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Good things to ask me*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `• "Summarize the last 20 messages in this channel"\n` +
            `• "Draft a reply to the latest message"\n` +
            `• "What are the open action items from today's discussion?"\n` +
            `• "Remind me about this conversation in an hour"`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Powered by *Dispatch* • Manage your agents in your Dispatch dashboard",
          },
        ],
      },
    ],
  };
}
