import type { SlackAdapter, SlackThreadId } from "@chat-adapter/slack";
import type { Thread } from "chat";

/**
 * Slack-specific title helper for the Assistants API.
 *
 * Only `setTitle` lives here now. The old `setStatus` helper was
 * deleted: it called `slackAdapter.setAssistantStatus()`, which is
 * the exact same Slack endpoint (`assistant.threads.setStatus`)
 * that `thread.startTyping(status)` hits internally — see
 * `node_modules/@chat-adapter/slack/dist/index.js:2694-2720`. Keeping
 * both was a literal duplicate API call, so the handler now uses
 * only `thread.startTyping(status)` for progress updates.
 *
 * **Why a helper file.** The platform-agnostic handler in
 * `lib/chat/handlers/message.ts` would otherwise need to:
 *   1. Check if the adapter is Slack
 *   2. Cast to SlackAdapter
 *   3. Decode the thread ID into channel + threadTs
 *   4. Call the right method
 *   5. Wrap in try/catch
 * Every time it wants to update the assistant thread title. Hiding
 * all of that here keeps the handler lean and stays consistent with
 * the "platform-specific details live in one place" rule.
 */

/**
 * Set the title shown for this assistant thread in history.
 * Slack assistants API only; no-op elsewhere.
 *
 * Use a short, descriptive title derived from the first user
 * message (e.g. "Summarize Q2 roadmap" instead of the default bot
 * name). This dramatically improves the "assistant history" view
 * in Slack's side panel.
 */
export async function setTitle(thread: Thread, title: string): Promise<void> {
  if (thread.adapter.name !== "slack") return;
  try {
    const slack = thread.adapter as unknown as SlackAdapter;
    const decoded = slack.decodeThreadId(thread.id) as SlackThreadId;
    // Bound the title length — Slack caps it but we want to enforce
    // a clean truncation here rather than getting ellipsized on the
    // far side.
    const trimmed = title.length > 80 ? title.slice(0, 77) + "…" : title;
    await slack.setAssistantTitle(decoded.channel, decoded.threadTs, trimmed);
  } catch {
    // Same rationale as setStatus.
  }
}
