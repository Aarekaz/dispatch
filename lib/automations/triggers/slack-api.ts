/**
 * Thin native Slack Web API wrappers for the channel scanner.
 *
 * Uses the bot token from Chat SDK's state store (chatKv), NOT
 * Composio. Four endpoints, Result-typed, no @slack/web-api dep.
 */

export type SlackApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SlackApiError };

export type SlackApiError =
  | { kind: "token_invalid"; detail: string }
  | { kind: "channel_access"; detail: string }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "transport"; detail: string }
  | { kind: "unknown"; detail: string };

export type SlackMessage = {
  type: string;
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  reply_count?: number;
  thread_ts?: string;
  subtype?: string;
};

function classifyError(slackError: string): SlackApiError {
  if (
    ["token_revoked", "invalid_auth", "not_authed", "account_inactive"].includes(
      slackError,
    )
  ) {
    return { kind: "token_invalid", detail: slackError };
  }
  if (
    ["channel_not_found", "not_in_channel", "is_archived"].includes(slackError)
  ) {
    return { kind: "channel_access", detail: slackError };
  }
  if (slackError === "ratelimited") {
    return { kind: "rate_limited", retryAfterSec: 30 };
  }
  return { kind: "unknown", detail: slackError };
}

async function slackFetch<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackApiResult<T>> {
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return {
        ok: false,
        error: { kind: "transport", detail: `HTTP ${res.status}` },
      };
    }

    const data = await res.json();
    if (!data.ok) {
      const error = classifyError(data.error ?? "unknown");
      if (error.kind === "rate_limited" && data.headers) {
        const retryAfter = parseInt(
          res.headers.get("retry-after") ?? "30",
          10,
        );
        return {
          ok: false,
          error: { kind: "rate_limited", retryAfterSec: retryAfter },
        };
      }
      return { ok: false, error };
    }

    return { ok: true, value: data as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "transport",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function fetchChannelHistory(
  token: string,
  channelId: string,
  oldestSec: number,
  limit: number = 200,
): Promise<SlackApiResult<SlackMessage[]>> {
  const result = await slackFetch<{ messages: SlackMessage[] }>(
    token,
    "conversations.history",
    { channel: channelId, oldest: String(oldestSec), limit },
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value.messages ?? [] };
}

export async function addReaction(
  token: string,
  channelId: string,
  messageTs: string,
  emoji: string,
): Promise<SlackApiResult<void>> {
  const result = await slackFetch<Record<string, unknown>>(
    token,
    "reactions.add",
    { channel: channelId, timestamp: messageTs, name: emoji },
  );
  if (!result.ok) {
    // "already_reacted" is not an error — idempotent
    if (result.error.kind === "unknown" && result.error.detail === "already_reacted") {
      return { ok: true, value: undefined };
    }
    return result;
  }
  return { ok: true, value: undefined };
}

export async function postInThread(
  token: string,
  channelId: string,
  threadTs: string | null,
  text: string,
): Promise<SlackApiResult<{ ts: string }>> {
  const body: Record<string, unknown> = { channel: channelId, text };
  if (threadTs) body.thread_ts = threadTs;

  const result = await slackFetch<{ ts: string }>(
    token,
    "chat.postMessage",
    body,
  );
  if (!result.ok) return result;
  return { ok: true, value: { ts: result.value.ts } };
}

export type SlackChannel = {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
};

/**
 * List public channels the bot is a member of.
 * Used by the delivery channel picker.
 */
export async function listBotChannels(
  token: string,
): Promise<SlackApiResult<SlackChannel[]>> {
  const result = await slackFetch<{ channels: SlackChannel[] }>(
    token,
    "conversations.list",
    {
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
    },
  );
  if (!result.ok) return result;
  // Only return channels the bot is a member of
  const channels = (result.value.channels ?? []).filter((c) => c.is_member);
  return { ok: true, value: channels };
}

export async function resolveChannelName(
  token: string,
  channelId: string,
): Promise<SlackApiResult<string>> {
  const result = await slackFetch<{ channel: { name: string } }>(
    token,
    "conversations.info",
    { channel: channelId },
  );
  if (!result.ok) return result;
  return { ok: true, value: result.value.channel?.name ?? channelId };
}
