/**
 * Channel slugs owned by Chat SDK, not by Composio.
 *
 * Chat SDK's `thread.post()` already delivers replies on these
 * platforms (see `lib/chat/handlers/message.ts`). If Composio's
 * same-named toolkits (`slack_send_message`, `telegram_send_message`,
 * etc.) were exposed to the LLM alongside Chat SDK delivery, the
 * model might call them redundantly — producing double posts,
 * wrong-channel posts, or posts using the wrong OAuth scopes.
 *
 * We keep Chat SDK as the single source of truth for these channels
 * by filtering these slugs in two places:
 *
 *   1. `lib/composio/toolkits.ts` → `listAvailableToolkits()`
 *      Hides them from the catalog UI so users never enable them.
 *   2. `lib/composio/session.ts` → `getComposioMcpConfig()`
 *      Defensive strip: if a legacy agent record still has the slug
 *      in `composioToolkits`, we remove it before asking Composio
 *      for an MCP session. The LLM never sees these tools.
 *
 * See `docs/superpowers/specs/2026-04-17-chat-sdk-modernization.md`
 * for the full rationale.
 */
export const CHAT_SDK_CHANNEL_SLUGS: ReadonlySet<string> = new Set([
  "slack",
  "telegram",
]);
