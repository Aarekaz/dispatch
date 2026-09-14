import type { SlackAdapter } from "@chat-adapter/slack";
import type { AppHomeOpenedEvent } from "chat";

import { buildHomeView } from "@/lib/chat/views/home-view";

/**
 * Handler for Slack's `app_home_opened` event. Fires every time a
 * user clicks the bot in their Apps sidebar and opens the Home tab.
 *
 * We publish a fresh Home view on every open so the content can
 * evolve with the product (e.g., showing recent agent activity)
 * without requiring users to refresh. Publishing is idempotent —
 * re-publishing the same view is a no-op on Slack's side.
 *
 * The view itself is defined in `lib/chat/views/home-view.ts`.
 * Keeping the view template separate from the event handler makes
 * the view easy to preview, test, and update without touching the
 * event wiring.
 */
export async function handleAppHomeOpened(
  event: AppHomeOpenedEvent,
): Promise<void> {
  if (event.adapter.name !== "slack") return;

  try {
    const slack = event.adapter as unknown as SlackAdapter;
    await slack.publishHomeView(event.userId, buildHomeView());
  } catch (err) {
    // Non-fatal — users just see an empty home tab. Log for diagnostics.
    console.warn(
      "[chat-sdk:app-home] publishHomeView failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
