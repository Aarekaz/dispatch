import type { Message, Thread } from "chat";

/**
 * Per-platform binding-key extraction with scope precedence.
 *
 * **This is the only place in the codebase that touches platform-
 * specific raw message fields.** Adding a new platform means adding
 * one branch here, not threading new fields through the handler.
 *
 * Returns an ARRAY of candidate keys in **priority order** (most
 * specific first). The resolver tries each in turn and returns the
 * first match. The prefix convention encodes the scope:
 *
 *   - `chan:<id>` — channel-specific binding (highest priority)
 *   - `team:<id>` — workspace-wide binding (fallback)
 *
 * **Why prefixes instead of separate fields?** The schema's
 * `agentIntegrations.channelBinding` field is a single string and
 * already indexed by `by_binding`. A prefix convention is a zero-
 * migration way to express scope. The prefix lives in this file and
 * the corresponding `bindAgent` mutation — nowhere else needs to
 * know it.
 *
 * **Why channel beats workspace?** Standard specificity precedence:
 * a more-specific binding always overrides a more-general one.
 * Same rule as CSS selectors, IAM policies, and route matching.
 *
 * Example for Slack: workspace T0123 has Sara bound workspace-wide
 * AND Marcus bound to channel C0789. A message in C0789 returns
 * `["chan:C0789", "team:T0123"]` and the resolver picks Marcus.
 * A message in C0888 (no channel binding) returns the same array
 * and the resolver picks Sara.
 */
export function getBindingKeys(
  thread: Thread,
  message: Message,
): string[] {
  switch (thread.adapter.name) {
    case "slack": {
      // Slack supports both channel- and workspace-level binding.
      // The team_id lives on the raw event payload (SlackEvent).
      const raw = message.raw as { team_id?: string; team?: string } | undefined;
      const teamId = raw?.team_id ?? raw?.team;
      const channelKey = `chan:${thread.channelId}`;
      return teamId ? [channelKey, `team:${teamId}`] : [channelKey];
    }
    default:
      // Telegram, Discord, etc. (Phase 2+) — channel-only by default.
      // Add scope-specific branches here as new platforms land.
      return [`chan:${thread.channelId}`];
  }
}

/**
 * Build a binding-key string from a (scope, id) pair. Use this when
 * inserting an `agentIntegrations` row from a UI flow (e.g. the Slack
 * pick page) so the encoding stays in sync with `getBindingKeys`.
 */
export function makeBindingKey(
  scope: "channel" | "workspace",
  id: string,
): string {
  return scope === "channel" ? `chan:${id}` : `team:${id}`;
}
