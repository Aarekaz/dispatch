import type { Thread } from "chat";

/**
 * Options for {@link formatThreadAsTranscript}.
 */
export type TranscriptOptions = {
  /**
   * Maximum number of messages to include. Iteration starts from the
   * most recent and walks backwards, so this caps the transcript at
   * the N most recent messages. Defaults to 30 — balances context
   * quality against token cost. For a 128k-context model this is ~3-5k
   * tokens of history, which leaves plenty of room for tool calls and
   * the response.
   */
  maxMessages?: number;

  /**
   * Maximum characters per individual message before truncation.
   * Defends against pathological cases like a 10k-char log paste
   * blowing out the context window. Defaults to 500.
   */
  maxCharsPerMessage?: number;
};

/**
 * Format a Chat SDK {@link Thread} as a readable text transcript for
 * LLM context injection. Used by `lib/chat/handlers/message.ts` to
 * give the agent full awareness of what's been said in a Slack thread
 * (or any other Chat-SDK-supported platform) before responding.
 *
 * **Why this exists.** The agent runs in an isolated Daytona sandbox
 * via OpenCode and has no direct knowledge of Slack. The Chat SDK
 * layer (which runs on Vercel and has the bot token) is the only
 * place where thread history is accessible. This helper is the bridge:
 * fetch history via Chat SDK, serialize it as text, then inject into
 * the OpenCode prompt. This matches the pattern used by every serious
 * chat-agent integration:
 *
 *   - Vercel's AI SDK Slackbot cookbook: `getThread()` → AI SDK messages
 *   - Goose's slackbot: channel + thread context → system prompt
 *   - OpenHands: session-bound thread state
 *
 * **What makes this one different.** We serialize to TEXT rather than
 * to AI SDK's structured `messages` array because OpenCode's
 * `session.prompt()` takes a single text prompt, not a messages array.
 * The caller wraps this transcript in explicit framing ("You are X,
 * responding in a Slack thread, here's the history, respond to the
 * latest") before passing it along.
 *
 * **Output shape.** A newline-joined string like:
 *
 *   [Alice]: Let's discuss the X project
 *   [Bob]: I have concerns about Q2 timelines
 *   [Alex (you)]: I can help — tell me more
 *   [Alice]: Bob, elaborate?
 *   [Anurag]: @Alex can you summarize above?
 *
 * Bot's own previous messages are labeled `(you)` so the LLM
 * recognizes them as its own prior output rather than user input.
 *
 * Returns `null` if zero usable messages were fetched (fresh thread,
 * empty channel, upstream API error, etc.). The caller should fall
 * back to the raw user message text in that case.
 *
 * **Error behavior.** This function never throws. If iteration of
 * `thread.messages` throws partway through, we log a warning and
 * return whatever we successfully collected. If nothing was collected,
 * returns `null`. Callers can safely await this without a try/catch.
 */
export async function formatThreadAsTranscript(
  thread: Thread,
  options: TranscriptOptions = {},
): Promise<string | null> {
  const maxMessages = options.maxMessages ?? 30;
  const maxChars = options.maxCharsPerMessage ?? 500;

  // Collected in iteration order (newest first, per Postable.messages
  // iteration contract). We'll reverse at the end for chronological
  // display. Storing the minimal fields we need rather than the full
  // Message objects keeps the transcript path cheap on memory even
  // when Chat SDK is auto-paginating a long thread.
  const collected: Array<{
    author: string;
    text: string;
    isBot: boolean;
  }> = [];

  try {
    for await (const msg of thread.messages) {
      if (collected.length >= maxMessages) break;

      // Attachment-only messages (or messages with whitespace-only
      // text) add noise without signal — skip them.
      const text = (msg.text ?? "").trim();
      if (!text) continue;

      // Prefer the human display name (e.g. "Anurag"). Fall back to
      // the @-handle (e.g. "anurag"), then to a generic label. The
      // fullName field is typed as `string` on Author, but we defend
      // against platforms that might return an empty string.
      const author =
        msg.author.fullName?.trim() ||
        msg.author.userName?.trim() ||
        "user";

      // `isMe` is set by Chat SDK after the bot user info is resolved.
      // When true, this message is the bot's own previous output.
      const isBot = msg.author.isMe === true;

      // Truncate pathologically long messages so a single log-paste
      // can't blow the prompt budget. 500 chars is ~100 tokens —
      // enough for any real conversation message.
      const truncated =
        text.length > maxChars ? text.slice(0, maxChars) + "…" : text;

      collected.push({ author, text: truncated, isBot });
    }
  } catch (err) {
    // Iteration failed partway through (rate limit, network, etc.).
    // Log and continue with whatever we successfully fetched — a
    // partial transcript is strictly better than no transcript.
    console.warn(
      "[chat-sdk] thread transcript iteration error:",
      err instanceof Error ? err.message : err,
    );
  }

  if (collected.length === 0) return null;

  // Reverse to chronological order (oldest first) so the transcript
  // reads like a conversation rather than a reversed log.
  collected.reverse();

  return collected
    .map((line) => {
      const label = line.isBot ? `${line.author} (you)` : line.author;
      return `[${label}]: ${line.text}`;
    })
    .join("\n");
}
