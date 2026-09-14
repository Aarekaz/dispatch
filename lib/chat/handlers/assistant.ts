import type { SlackAdapter } from "@chat-adapter/slack";
import type {
  AssistantContextChangedEvent,
  AssistantThreadStartedEvent,
} from "chat";

import { BOT_NAME } from "@/lib/config/branding";

/**
 * Handlers for Slack's Assistants API side-panel experience.
 *
 * When an operator enables "Agent or Assistant" in the Slack app's
 * App Home settings, users get a dedicated side panel for chatting
 * with the bot — like ChatGPT's sidebar but inside Slack. Opening
 * that panel fires `assistant_thread_started`, and navigating
 * between channels while it's open fires `assistant_thread_context_changed`.
 *
 * These handlers register alongside the regular message handlers
 * in `lib/chat/bot.ts`. They're Slack-specific because the
 * Assistants API is Slack-specific; other platforms ignore these
 * events.
 */

/**
 * Fires when a user opens an assistant panel thread for the first
 * time. We use it to populate the empty-state with clickable
 * suggested prompts — the Slack equivalent of ChatGPT's "example
 * prompts" grid. Users clicking a prompt submits it as a regular
 * message which flows through `handleSubscribedMessage` exactly
 * like any other chat.
 *
 * The suggested prompts shown here are deliberately generic
 * because at assistant-thread-open time we don't yet know which
 * Dispatch agent (Sara, Marcus, Alex, etc.) the user will
 * interact with — that resolution happens in `runTurn` via the
 * channel binding. Phase 2 could personalize these based on a
 * workspace → agent lookup at open time.
 */
export async function handleAssistantThreadStarted(
  event: AssistantThreadStartedEvent,
): Promise<void> {
  if (event.adapter.name !== "slack") return;

  try {
    const slack = event.adapter as unknown as SlackAdapter;
    await slack.setSuggestedPrompts(
      event.channelId,
      event.threadTs,
      [
        {
          title: "Summarize this channel",
          message: "Summarize the recent conversation in this channel.",
        },
        {
          title: "Draft a reply",
          message: "Help me draft a reply to the most recent message above.",
        },
        {
          title: "What can you do?",
          message: `What kinds of tasks can you help me with?`,
        },
      ],
      `${BOT_NAME} — pick a prompt to get started`,
    );
  } catch (err) {
    // Non-fatal — users can still type their own message in the
    // assistant panel. Just log so we can diagnose any systemic issue.
    console.warn(
      "[chat-sdk:assistant] setSuggestedPrompts failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Fires when the user's context changes inside an assistant panel
 * (e.g. they navigate from `#support` to `#sales` with the panel
 * still open). Slack sends us the new channel so we could refresh
 * suggested prompts or pre-fetch context for the new channel.
 *
 * For now we just log — Phase 2 could use this to keep suggested
 * prompts in sync with the active channel's agent binding.
 */
export async function handleAssistantContextChanged(
  event: AssistantContextChangedEvent,
): Promise<void> {
  const newChannel = event.context.channelId ?? "(unknown)";
  console.log(
    `[chat-sdk:assistant] context changed user=${event.userId.slice(0, 8)} → channel=${newChannel}`,
  );
}
