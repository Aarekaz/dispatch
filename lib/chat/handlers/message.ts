import { fetchMutation, fetchQuery } from "convex/nextjs";
import { Plan, type Message, type Thread } from "chat";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning } from "@/lib/agents/ensure-running";
import { runAgent } from "@/lib/agents/run-agent";
import { setTitle } from "@/lib/chat/context/slack-status";
import { formatThreadAsTranscript } from "@/lib/chat/context/thread-transcript";
import { reportFailure } from "@/lib/chat/error-reporter";
import type { ClassifiedError } from "@/lib/chat/errors";
import {
  resolveAgentForThread,
  type ResolvedAgent,
} from "@/lib/chat/routing/resolve-agent";
import { getSecret } from "@/lib/chat/secrets";
import { toChatStream } from "@/lib/chat/stream-bridge";
import { BOT_NAME } from "@/lib/config/branding";
import type { RuntimeUsage } from "@/lib/runtime";
import { createRuntimeAdapter } from "@/lib/runtime/factory";

/**
 * Platform-agnostic message handler.
 *
 * This file is the **entire business logic of every Chat SDK platform
 * integration in Dispatch.** It is mounted three different ways from
 * `lib/chat/bot.ts`:
 *
 *   bot.onNewMention(handleMention)
 *   bot.onSubscribedMessage(handleSubscribed)
 *   bot.onDirectMessage(handleDirectMessage)
 *
 * It NEVER references Slack/Telegram/Discord/etc. by name. The
 * `thread` and `message` arguments come from Chat SDK already
 * normalized — they look identical regardless of which platform the
 * webhook arrived from. Adding a new platform requires zero changes
 * to this file.
 *
 * Flow per turn:
 *
 *   1. Resolve which Dispatch agent owns this channel via the
 *      `(adapter.name, thread.channelId)` binding. Bail with a
 *      visible message if no binding exists.
 *
 *   2. Wake the agent's Daytona sandbox. Bail visibly on failure
 *      so customers see "couldn't wake the agent" instead of a
 *      silent timeout.
 *
 *   3. Look up the OpenCode session for this thread (cached on
 *      `thread.setState` so the same Slack thread keeps continuous
 *      OpenCode memory across turns), or create a new one.
 *
 *   4. Stream events from `runAgent()` through `toChatStream()` and
 *      pipe them to `thread.post()`. Slack renders task cards
 *      natively; other platforms get the text-only fallback.
 *
 *   5. After the stream completes, log the run + persist messages
 *      to Convex so the Activity feed at `/[agentId]/activity`
 *      reflects the activity.
 */

/** State stored on a Chat SDK thread for cross-turn continuity. */
type ThreadState = {
  /** OpenCode session ID — the same session is reused for every turn in a thread. */
  opencodeSessionId?: string;
  /**
   * Count of back-to-back `runTurn` failures on this thread. Incremented
   * on every error path, reset on success, and reset to zero whenever a
   * fresh subscribe lands (mention / DM). When it hits
   * `MAX_CONSECUTIVE_FAILURES` we auto-unsubscribe so the thread stops
   * burning compute on a deterministic failure — e.g. a broken sandbox
   * or a revoked integration — until the customer re-mentions us.
   */
  consecutiveFailures?: number;
};

/**
 * After this many back-to-back failures on the same thread we
 * auto-unsubscribe and surface an "admin has been notified" message.
 * Three strikes is small enough to catch a deterministic failure
 * quickly (broken sandbox, expired integration, agent deleted) and
 * large enough to survive a single transient blip. Resets to zero on
 * any successful turn or on a fresh subscribe.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Shared wrapper that runs an event handler's body inside a
 * top-level try/catch AND logs entry/exit.
 *
 * **Why this exists.** Our outer safety net in `runTurn` catches
 * errors that escape the per-step handlers inside the turn — but it
 * does NOT catch errors that fire BEFORE `runTurn` is called. The
 * most likely pre-runTurn throw points are:
 *
 *   - `thread.subscribe()` hitting a state-adapter failure
 *   - Chat SDK internal failure during dispatch
 *   - Any future handler setup code we add to handleMention et al
 *
 * Without this wrapper, those errors flow back into Chat SDK's
 * internal error handling and effectively disappear from our own
 * log stream — which is exactly the "silent failure" class of bug
 * I'm hunting. With this wrapper, we ALWAYS log entry + exit OR
 * entry + uncaught with a full stack trace.
 *
 * The `handlerName` is logged so we can tell which Chat SDK event
 * path fired (`mention` / `subscribed` / `dm`).
 */
async function safeHandler(
  handlerName: "mention" | "subscribed" | "dm",
  thread: Thread<ThreadState>,
  message: Message,
  fn: () => Promise<void>,
): Promise<void> {
  const platform = thread.adapter.name;
  const start = performance.now();

  console.log(
    `[handler:${handlerName}] entry platform=${platform} threadId=${thread.id?.slice(0, 40)} messageId=${message.id?.slice(0, 12)} from=${message.author.fullName?.trim() || message.author.userName?.trim() || "unknown"}`,
  );

  try {
    await fn();
    const ms = Math.round(performance.now() - start);
    console.log(
      `[handler:${handlerName}] exit +${ms}ms platform=${platform}`,
    );
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(
      `[handler:${handlerName}] UNCAUGHT +${ms}ms platform=${platform}\n${detail}`,
    );
    // Best-effort: try to tell the user something went wrong. This
    // is the last line of defense — if this post also fails, there's
    // nothing more we can do.
    try {
      await thread.post(
        `Sorry — something went wrong on my end. Please try again in a moment.`,
      );
    } catch {
      /* swallow — last-line-of-defense post failed, nothing we can do */
    }
  }
}

/**
 * Reset the consecutive-failure counter on a thread. Called from the
 * subscribe-on-entry paths (`handleMention`, `handleDirectMessage`)
 * so that a re-engagement after auto-unsubscribe gets a fresh failure
 * budget. Non-fatal — if the state write fails we just log and
 * proceed; the worst case is the counter stays at whatever it was
 * and the user hits `MAX_CONSECUTIVE_FAILURES` one message earlier.
 *
 * Only writes when the counter is actually non-zero to avoid an
 * extra state round-trip on the common case where the thread was
 * already healthy.
 */
async function resetConsecutiveFailures(
  thread: Thread<ThreadState>,
): Promise<void> {
  try {
    const current = await thread.state;
    if (current?.consecutiveFailures && current.consecutiveFailures > 0) {
      await thread.setState({ consecutiveFailures: 0 });
    }
  } catch (err) {
    console.warn(
      `[handler] resetConsecutiveFailures failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Handle the bot being @-mentioned in an unsubscribed thread.
 * Subscribes to the thread so subsequent messages flow through
 * `handleSubscribedMessage`.
 */
export async function handleMention(
  thread: Thread<ThreadState>,
  message: Message,
): Promise<void> {
  return safeHandler("mention", thread, message, async () => {
    await thread.subscribe();
    // A fresh @-mention is a fresh failure budget — reset the counter
    // so a previously failing thread gets another `MAX_CONSECUTIVE_FAILURES`
    // attempts before auto-unsubscribing again.
    await resetConsecutiveFailures(thread);
    await runTurn(thread, message);
  });
}

/**
 * Handle a follow-up message in a thread the bot is already
 * subscribed to.
 *
 * **Channel behavior — only responds when @-mentioned again.**
 * In Slack channel threads (and other multi-party platform threads),
 * the bot lurks silently after the first @-mention until it's
 * explicitly re-tagged. This matches the standard Slack-bot pattern
 * used by ChatGPT, Linear's bot, Cody, etc. — the bot is "in the
 * room" for context but doesn't talk over the team's conversation.
 *
 * **Why we still subscribe.** The thread subscription enables Chat
 * SDK's per-thread queue strategy, dedupe TTL, and `thread.state`
 * (where we store `opencodeSessionId` for session continuity).
 * Unsubscribing would lose all of that. We just filter at the
 * decision point inside this handler instead.
 *
 * **DM / assistant panel behavior — always responds.** When
 * `thread.isDM === true` (covers regular DMs, group DMs, AND the
 * Slack Assistants API side panel — all three come through as
 * `channel_type === "im"` per the Slack adapter), the @-mention
 * filter is dropped because users in 1:1 conversations expect every
 * message to get a reply. The first DM still routes through
 * `handleDirectMessage` which subscribes; subsequent DMs flow
 * through here and bypass the filter via `thread.isDM`.
 */
export async function handleSubscribedMessage(
  thread: Thread<ThreadState>,
  message: Message,
): Promise<void> {
  return safeHandler("subscribed", thread, message, async () => {
    // Channel filter: in multi-party threads (anything that isn't a
    // 1:1 / DM / assistant panel), only respond to messages where
    // the bot was explicitly @-tagged. `message.isMention` is set by
    // Chat SDK based on the adapter's knowledge of `botUserId`, so
    // this is per-bot accurate even if multiple bots share a channel.
    //
    // Bail BEFORE `runTurn` so we don't pay for the :eyes: reaction,
    // sandbox wake, OpenCode session lookup, or transcript fetch on
    // a message we're not going to answer. Silent skip — no reaction,
    // no error, the bot just stays quiet (which is what users
    // sending a non-mention message expect).
    if (!thread.isDM && !message.isMention) {
      console.log(
        `[handler:subscribed] skipped non-mention threadId=${thread.id?.slice(0, 40)} from=${message.author.userName?.trim() || message.author.fullName?.trim() || "unknown"}`,
      );
      return;
    }
    await runTurn(thread, message);
  });
}

/**
 * Handle a direct message to the bot. Subscribes to the DM thread
 * the same way new mentions do, then runs the turn.
 */
export async function handleDirectMessage(
  thread: Thread<ThreadState>,
  message: Message,
): Promise<void> {
  return safeHandler("dm", thread, message, async () => {
    await thread.subscribe();
    // Fresh DM = fresh failure budget. Same rationale as `handleMention`.
    await resetConsecutiveFailures(thread);
    await runTurn(thread, message);
  });
}

// ── Internals ────────────────────────────────────────────────

async function runTurn(
  thread: Thread<ThreadState>,
  message: Message,
  preResolvedAgent?: ResolvedAgent,
): Promise<void> {
  const platform = thread.adapter.name;

  // ── Turn correlation ID. Every turn gets a short random ID that
  // gets prefixed on every log line so we can grep across the
  // Vercel function log stream to trace a single message end-to-end.
  // 8 chars of hex is plenty to disambiguate concurrent turns.
  const turnId = crypto.randomUUID().slice(0, 8);
  const turnStart = performance.now();

  /** Log a lifecycle milestone with cumulative ms from turn start. */
  const logTurn = (stage: string, extra?: Record<string, unknown>): void => {
    const ms = Math.round(performance.now() - turnStart);
    const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
    console.log(`[turn:${turnId}] ${stage} +${ms}ms platform=${platform}${suffix}`);
  };

  /** Log a failure with the stage name and the error (stack if available). */
  const logTurnError = (stage: string, err: unknown): void => {
    const ms = Math.round(performance.now() - turnStart);
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(
      `[turn:${turnId}] ${stage} FAILED +${ms}ms platform=${platform}\n${detail}`,
    );
  };

  logTurn("start", {
    messageId: message.id?.slice(0, 12),
    threadId: thread.id?.slice(0, 32),
    author:
      message.author.fullName?.trim() ||
      message.author.userName?.trim() ||
      "unknown",
    isDM: thread.isDM,
    textLen: (message.text ?? "").length,
  });

  // ── Immediate feedback: react with :eyes: so the customer sees
  // "I received your message" the instant the webhook lands, before
  // any of the slower resolve → wake → stream path runs. Wrapped in
  // try/catch because losing a feedback reaction is strictly better
  // than failing the whole turn on a transient reaction-API hiccup.
  //
  // Reactions live on the Adapter interface (not on Message), so we
  // route through `thread.adapter.addReaction(threadId, messageId, emoji)`.
  // `message.threadId` + `message.id` are the platform-encoded IDs
  // the adapter expects.
  let acknowledged = false;
  try {
    await thread.adapter.addReaction(message.threadId, message.id, "eyes");
    acknowledged = true;
  } catch (err) {
    console.warn(`[turn:${turnId}] :eyes: reaction failed:`, err);
  }

  // Helper: swap the :eyes: receipt for a terminal emoji on
  // success/failure. All failures are swallowed — reactions are
  // non-essential and must never break the response path.
  const markComplete = async (
    emoji: "white_check_mark" | "x",
  ): Promise<void> => {
    if (acknowledged) {
      try {
        await thread.adapter.removeReaction(
          message.threadId,
          message.id,
          "eyes",
        );
      } catch {
        /* swallow */
      }
    }
    try {
      await thread.adapter.addReaction(message.threadId, message.id, emoji);
    } catch {
      /* swallow */
    }
  };

  // ── Progress indicator helper ───────────────────────────────
  // `thread.startTyping(status)` internally maps to Slack's
  // `assistant.threads.setStatus` API per
  // `node_modules/@chat-adapter/slack/dist/index.js:2694-2720`. That
  // means one call drives BOTH the assistants-panel status line AND
  // any typing indicator the platform can surface. We previously
  // emitted `setStatus(...)` AND `startTyping("thinking")` back-to-back,
  // which was a literal duplicate — same endpoint, same payload.
  //
  // Fire-and-forget: a failing status update must never block or
  // fail the user-visible response path.
  const setProgress = (status: string): void => {
    thread.startTyping(status).catch((err) => {
      console.warn(`[turn:${turnId}] startTyping(${status}) failed:`, err);
    });
  };

  // ── Consecutive-failure tracker ─────────────────────────────
  // Counts back-to-back `runTurn` failures on this thread. Reset
  // on success. When it reaches `MAX_CONSECUTIVE_FAILURES`, we
  // auto-unsubscribe so a deterministic failure (broken sandbox,
  // revoked integration) stops burning compute on every follow-up
  // message until the customer re-mentions us.
  //
  // `recordFailure` OWNS the error-path post for the user. Callers
  // must NOT call `thread.post(userVisibleError)` themselves — this
  // helper either posts the normal error message OR swaps it for
  // the auto-unsubscribe message once the threshold is hit.
  //
  // The `alreadyPosted` flag is set by the mid-stream error path:
  // when the runtime emitted a `run.error` event, `stream-bridge.ts`
  // already yielded the real error as a visible markdown chunk and
  // `thread.post(...)` already streamed it to the user. We still
  // want to increment the failure counter and potentially auto-
  // unsubscribe, but posting a second generic "something went wrong"
  // message on top of the real one would be noisy and confusing.
  // The auto-unsubscribe message DOES still fire when triggered
  // because it's a state transition the user needs to see.
  const recordFailure = async (
    userVisibleError: string,
    opts: { alreadyPosted?: boolean } = {},
  ): Promise<void> => {
    let nextCount = 1;
    try {
      const current = await thread.state;
      nextCount = (current?.consecutiveFailures ?? 0) + 1;
      await thread.setState({ consecutiveFailures: nextCount });
    } catch (err) {
      // Reading/writing state failed — log and fall through to the
      // normal error post. We'd rather surface the original error
      // than hide it behind a new "couldn't track failures" message.
      logTurnError("recordFailure.setState", err);
    }

    if (nextCount >= MAX_CONSECUTIVE_FAILURES) {
      logTurn("auto-unsubscribe", { failures: nextCount });
      try {
        await thread.unsubscribe();
      } catch (err) {
        logTurnError("recordFailure.unsubscribe", err);
      }
      try {
        await thread.post(
          `I'm having trouble responding in this thread — an admin has been notified. To resume, @mention me again after the issue is fixed.`,
        );
      } catch {
        /* swallow — last-line-of-defense post failed */
      }
      return;
    }

    if (opts.alreadyPosted) return;

    try {
      await thread.post(userVisibleError);
    } catch {
      /* swallow — last-line-of-defense post failed */
    }
  };

  // Reset the failure counter on success so a healthy thread doesn't
  // carry a stale count forward. Only writes when there's actually
  // something to clear, to avoid an unnecessary state round-trip on
  // every happy-path turn.
  const recordSuccess = async (): Promise<void> => {
    try {
      const current = await thread.state;
      if (current?.consecutiveFailures && current.consecutiveFailures > 0) {
        await thread.setState({ consecutiveFailures: 0 });
      }
    } catch (err) {
      // Non-fatal: worst case the next failure counts from a stale
      // baseline. Log and move on.
      logTurnError("recordSuccess.setState", err);
    }
  };

  // ── Outer safety net. Everything below this runs inside a
  // top-level try/catch that logs full stack traces for anything
  // escaping the existing inner handlers (e.g., thread.state
  // throwing, runtime.createSession throwing, bugs in the
  // transcript fetcher). Without this, background failures inside
  // Vercel's `after(...)` callback would produce NO log output
  // because waitUntil already returned 200 to Slack — our only
  // window to see the error is the console.
  try {
    // ── Initial progressive status. In Slack's assistants panel
    // this shows "Thinking…" above the message composer so users
    // get feedback while we walk through the slow resolve → wake →
    // stream path. Single `startTyping` call — no duplicate
    // `setStatus` anymore. See `setProgress` comment above for why.
    setProgress("Thinking…");

    // 1. Route to the agent that should handle this message. When the
    // caller already knows the agent (e.g. Telegram multi-bot where
    // the agentId is in the webhook URL), skip the binding lookup.
    const agent = preResolvedAgent ?? await resolveAgentForThread(thread, message);
    if (!agent) {
      logTurn("no-agent-bound");
      await markComplete("x");
      await recordFailure(
        `No ${BOT_NAME} agent is connected to this channel yet. Connect one from your dashboard.`,
      );
      return;
    }
    logTurn("resolved", { agent: agent.agentName });

    // ── Transition: "Waking agent…" shows visible progress on the
    // slowest step of the pipeline. Warm sandboxes skip past this
    // in ~100ms; cold sandboxes spend 2-5 seconds here.
    setProgress(`Waking ${agent.agentName}…`);

    // 2. Wake the sandbox. Visible failure message on error.
    //
    // Composio identity here is the *agent owner*, not the chatter.
    // A random Slack/Telegram user chatting with the agent must not
    // get their own empty Composio account — they're just consumers
    // of whatever connections the owner has wired up.
    let previewUrl: string;
    try {
      const result = await ensureAgentRunning(agent.sandboxId, {
        name: agent.agentName,
        toolPermissions: agent.toolPermissions ?? undefined,
        userId: agent.userId,
        agentId: agent.agentId,
        composioToolkits: agent.composioToolkits,
        serverPassword: agent.serverPassword,
      });
      previewUrl = result.previewUrl;
      logTurn("sandbox-ready");
    } catch (err) {
      logTurnError("wake-sandbox", err);
      await markComplete("x");
      await recordFailure(
        `Couldn't wake ${agent.agentName} right now. Please try again in a moment.`,
      );
      return;
    }

    // ── Reset status to the thinking state now that the sandbox is up.
    setProgress("Thinking…");

    // 3. Look up (or create) the OpenCode session for this thread.
    //
    // Three-tier lookup:
    //   a) `thread.state.opencodeSessionId` — hot path, sub-100ms
    //      thanks to the in-memory micro-cache on the Convex state
    //      adapter. Chat SDK imposes a 30-day TTL on thread state,
    //      so this tier is volatile.
    //   b) `sessions.getByExternalThread` — persistent fallback
    //      keyed on the Chat SDK thread ID (`slack:C123:1699..`).
    //      Survives beyond the 30-day state TTL, survives a wiped
    //      `chatKv` table, survives anything short of actually
    //      deleting the `agentSessions` row. One Convex round-trip.
    //   c) Fresh OpenCode session — only reached when both caches
    //      miss. On creation we rewarm (a) via `setState` AND
    //      persist the mapping to (b) via `upsertFromWebhook` so
    //      the next turn finds it either way.
    const state = await thread.state;
    let sessionExternalId = state?.opencodeSessionId;

    if (!sessionExternalId) {
      try {
        const persisted = await fetchQuery(
          api.sessions.getByExternalThread,
          {
            agentId: agent.agentId,
            externalThreadId: thread.id,
            secret: getSecret(),
          },
        );
        if (persisted?.sessionExternalId) {
          sessionExternalId = persisted.sessionExternalId;
          // Rewarm the hot-path cache so subsequent turns within the
          // same 30-day window skip straight to (a).
          await thread.setState({ opencodeSessionId: sessionExternalId });
          logTurn("session-recovered", {
            sessionId: sessionExternalId.slice(0, 12),
          });
        }
      } catch (err) {
        // Non-fatal: we'll fall through to creating a fresh session.
        // This is strictly better than failing the turn on a lookup hiccup.
        logTurnError("sessions.getByExternalThread", err);
      }
    }

    const isNewSession = !sessionExternalId;
    if (!sessionExternalId) {
      const runtime = createRuntimeAdapter(previewUrl, agent.serverPassword);
      const session = await runtime.createSession(
        agent.agentId,
        "External thread",
      );
      sessionExternalId = session.sessionExternalId;
      await thread.setState({ opencodeSessionId: sessionExternalId });

      // Persist the (agent, externalThreadId) → sessionExternalId
      // mapping immediately so a failure later in the turn doesn't
      // leave the mapping unrecoverable after thread.state evicts.
      // `upsertFromWebhook` is idempotent — a later call with the
      // real title just patches the same row.
      try {
        await fetchMutation(api.sessions.upsertFromWebhook, {
          agentId: agent.agentId,
          sessionExternalId,
          externalThreadId: thread.id,
          secret: getSecret(),
        });
      } catch (err) {
        logTurnError("sessions.upsertFromWebhook (initial)", err);
      }
    }
    logTurn("session", {
      sessionId: sessionExternalId.slice(0, 12),
      new: isNewSession,
    });

    // ── 4. Context injection. Fetch the recent thread history via
    // Chat SDK and build a framed prompt. See lib/chat/context/thread-transcript.ts
    // for rationale. Falls back to raw user text if fetch fails.
    // 10 messages is enough for conversational continuity while keeping
    // the input token count manageable (~4k tokens vs ~12k at 30).
    // Lower token count = faster time-to-first-token from the model.
    const transcript = await formatThreadAsTranscript(thread, {
      maxMessages: 10,
    });
    logTurn("transcript", {
      lines: transcript ? transcript.split("\n").length : 0,
      fallback: !transcript,
    });

    // Build the prompt sent to OpenCode. The system prompt (set in the
    // OpenCode config via buildOpenCodeConfig) already contains the
    // agent's identity, persona, and sandbox instructions — don't
    // duplicate that here. This prompt only carries the CONVERSATION
    // CONTEXT that changes per turn.
    //
    // Keeping this lean helps with:
    //   1. Faster time-to-first-token (fewer input tokens for the model)
    //   2. Better prompt caching (the stable system prompt stays cached,
    //      only the variable transcript changes per turn)
    //   3. Lower cost (input tokens are billed)
    const scopeName = thread.isDM ? "direct message" : "thread";
    // Platform label for the prompt header — capitalize the adapter
    // name (`slack` → `Slack`, `telegram` → `Telegram`). The file
    // claims to be platform-agnostic but the prompt used to hardcode
    // "Slack" regardless of the actual source adapter, which meant
    // Telegram chats were prompted as if they were in Slack.
    const platformLabel =
      platform.charAt(0).toUpperCase() + platform.slice(1);

    // Delivery hint — tells the LLM that its reply text is posted by
    // Chat SDK automatically, so it should NOT reach for a tool to
    // send the message. Defends the Composio session filter
    // (`lib/composio/session.ts`) with a prompt-level guardrail in
    // case any future toolkit exposes a send-message action we don't
    // currently know about.
    const deliveryHint = [
      `Your reply is automatically delivered to this ${platformLabel} ${scopeName} — write your answer as plain text.`,
      `Do not call any tool to post your response (no slack_send_message, telegram_send_message, or equivalent).`,
    ].join(" ");

    const agentPrompt = transcript
      ? [
          `## ${platformLabel} ${scopeName} conversation`,
          ``,
          transcript,
          ``,
          deliveryHint,
          ``,
          `Respond to the most recent message above.`,
        ].join("\n")
      : [deliveryHint, ``, message.text ?? ""].join("\n");

    // ── 5. Stream the agent's response. Two failure paths converge
    // here — both ultimately flow through `reportFailure` in
    // `lib/chat/errors.ts` so there's exactly one place the system
    // records failures.
    //
    //   Path A — mid-stream `run.error` (e.g. OpenCode emitted
    //   session.error). The stream-bridge classifies the raw error
    //   and yields the user-friendly message as a markdown chunk,
    //   then fires `onClassified` with the result. We capture it
    //   in `classifiedError` below, the stream completes normally,
    //   and we post-process: report + mark X + record failure.
    //
    //   Path B — a thrown exception (e.g. Slack API flake,
    //   ChatStreamer bug, network error). Caught by the try/catch
    //   wrapping `thread.post`. If `classifiedError` was set before
    //   the throw, we report THAT. Otherwise we classify the thrown
    //   error's message as a raw input.
    //
    // ── Plan block (Slack AI thinking blocks) ──
    // Post a Chat SDK Plan before the stream runs so tool progress
    // renders as native `plan` + `task_card` Block Kit blocks rather
    // than inline task_update chunks. The Plan is its own message —
    // tool events mutate it in place while the text reply streams
    // below. Adapters without `postObject` support (Telegram,
    // Discord, etc.) return `false` from `isSupported()` and the
    // stream-bridge falls back to chunk-based task_update rendering
    // automatically.
    //
    // The plan is best-effort: if the initial post fails we continue
    // with chunk-based rendering as if the adapter didn't support
    // plans at all.
    let plan: Plan | null = null;
    try {
      const candidate = new Plan({
        initialMessage: `${agent.agentName} is thinking…`,
      });
      if (candidate.isSupported(thread.adapter)) {
        await thread.post(candidate);
        plan = candidate;
        logTurn("plan-posted");
      }
    } catch (err) {
      logTurnError("plan-post", err);
      plan = null;
    }

    logTurn("stream-start", { promptLen: agentPrompt.length });
    let fullAssistantText = "";
    let classifiedError: ClassifiedError | null = null;
    let streamUsage: RuntimeUsage | null = null;
    try {
      // Tee the events to accumulate assistant text + usage metrics.
      // Text goes to Convex message persistence; usage goes to the
      // run record so the events page can show model, tokens, credits.
      const events = teeAndAccumulate(
        runAgent({
          agentId: agent.agentId,
          sessionExternalId,
          message: agentPrompt,
          previewUrl,
          serverPassword: agent.serverPassword,
        }),
        {
          onText: (text) => {
            fullAssistantText += text;
          },
          onUsage: (usage) => {
            streamUsage = usage;
          },
        },
      );

      await thread.post(
        toChatStream(events, {
          agentName: agent.agentName,
          onClassified: (c) => {
            classifiedError = c;
          },
          plan,
        }),
      );
      logTurn("stream-done", {
        textLen: fullAssistantText.length,
        hadError: classifiedError !== null,
      });
    } catch (err) {
      logTurnError("stream", err);
      await markComplete("x");

      // Path B — thrown exception. If mid-stream classification
      // already happened (via onClassified), that's the real error;
      // the throw is a secondary consequence (e.g. Slack API threw
      // WHILE posting the classified error text). Report and record
      // with the classified result in that case. `as ClassifiedError`
      // is safe because we guard on non-null first; the narrowing
      // doesn't flow through the closure assignment from onClassified.
      if (classifiedError !== null) {
        const primary = classifiedError as ClassifiedError;
        await reportFailure({
          kind: "classified",
          classified: primary,
          agentId: agent.agentId,
          agentName: agent.agentName,
          sessionId: sessionExternalId,
          channel: platform,
          turnId,
        });
        await recordFailure(primary.userMessage, { alreadyPosted: true });
        await persistErrorMessage(
          agent.agentId, sessionExternalId, message.text, primary.userMessage,
        );
      } else {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const rawDetail = err instanceof Error ? err.stack ?? err.message : String(err);
        const classified = await reportFailure({
          kind: "raw",
          raw: rawMessage,
          adminDetail: rawDetail,
          agentId: agent.agentId,
          agentName: agent.agentName,
          sessionId: sessionExternalId,
          channel: platform,
          turnId,
        });
        await recordFailure(`_${classified.userMessage}_`, { alreadyPosted: false });
        await persistErrorMessage(
          agent.agentId, sessionExternalId, message.text, classified.userMessage,
        );
      }
      return;
    }

    // ── Path A — stream completed without throwing, but the bridge
    // surfaced a `run.error` event via onClassified. The user has
    // ALREADY seen the classified message (yielded as markdown in
    // stream-bridge). Report for persistence + counters, then bail
    // out before the success path. `alreadyPosted: true` suppresses
    // the generic "something went wrong" fallback because the
    // real message is already on screen.
    if (classifiedError !== null) {
      const primary = classifiedError as ClassifiedError;
      await reportFailure({
        kind: "classified",
        classified: primary,
        agentId: agent.agentId,
        agentName: agent.agentName,
        sessionId: sessionExternalId,
        channel: platform,
        turnId,
      });
      await markComplete("x");
      await recordFailure(primary.userMessage, { alreadyPosted: true });
      // Persist the error as an "assistant" message so the web chat
      // session view shows the same error the Slack user saw —
      // standardized UX across platforms.
      await persistErrorMessage(
        agent.agentId, sessionExternalId, message.text, primary.userMessage,
      );
      return;
    }

    // ── Terminal success reaction. Only reached when the stream
    // posted cleanly AND no run.error event was emitted.
    // Swaps :eyes: → :white_check_mark:.
    await markComplete("white_check_mark");
    await recordSuccess();

    // Finalize the plan block (if we posted one). `complete()` swaps
    // the plan header to the completion message so Slack shows a
    // clean "done" state instead of a stuck "…is thinking" title.
    // Fire-and-forget semantics via enqueueEdit — errors are logged
    // by Chat SDK internally and must not block the success path.
    if (plan) {
      try {
        await plan.complete({ completeMessage: "Done" });
      } catch (err) {
        logTurnError("plan-complete", err);
      }
    }

    // ── Update the assistant thread title so Slack's history panel
    // shows something descriptive. No-op outside Slack assistants panel.
    const userText = (message.text ?? "").trim();
    if (userText) {
      const title =
        userText.length > 60 ? userText.slice(0, 57) + "…" : userText;
      await setTitle(thread, title);
    }

    // ── 6. Persist the run + session + messages to Convex
    // (fire-and-forget — the customer already saw the response).
    // Each mutation has its own try/catch because partial
    // persistence is strictly better than none.
    const rawUserText = (message.text ?? "").trim();
    const summary = rawUserText
      ? rawUserText.length > 80
        ? rawUserText.slice(0, 77) + "…"
        : rawUserText
      : undefined;

    // Compute duration from the turn timer so the events page shows
    // how long the full turn took (wake + session + stream).
    const durationMs = Math.round(performance.now() - turnStart);
    const durationStr =
      durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`;

    // `usage` is captured via the `onUsage` closure in teeAndAccumulate.
    // TypeScript doesn't trust closure mutations across async boundaries,
    // so we snapshot into a local const to satisfy the narrowing.
    const usage = streamUsage as RuntimeUsage | null;

    try {
      await fetchMutation(api.runs.logInternal, {
        agentId: agent.agentId,
        sessionId: sessionExternalId,
        trigger: "webhook",
        channel: platform,
        status: "completed",
        summary,
        model: usage?.model ?? undefined,
        tokensIn: usage?.inputTokens ?? undefined,
        tokensOut: usage?.outputTokens ?? undefined,
        credits: usage?.estimatedCredits ?? undefined,
        duration: durationStr,
        secret: getSecret(),
      });
    } catch (err) {
      logTurnError("runs.logInternal", err);
    }

    // ── Deduct credits for this run. Fire-and-forget — a failed
    // deduction must never block the user-visible response path.
    if (usage?.costUsd && usage.costUsd > 0) {
      try {
        await fetchMutation(api.credits.deductForRun, {
          agentId: agent.agentId,
          costUsd: usage.costUsd,
          model: usage.model ?? undefined,
          tokensIn: usage.inputTokens ?? undefined,
          tokensOut: usage.outputTokens ?? undefined,
          secret: getSecret(),
        });
      } catch (err) {
        logTurnError("credits.deductForRun", err);
      }
    }

    // Mirror the web chat route's session title behavior so the
    // Activity feed displays the user's message via the `sessionTitle`
    // join instead of the "Handled a Slack conversation." placeholder.
    if (summary) {
      try {
        await fetchMutation(api.sessions.upsertFromWebhook, {
          agentId: agent.agentId,
          sessionExternalId,
          title: summary,
          // Repeat the externalThreadId here too — idempotent on the
          // Convex side, and self-healing if the initial upsert above
          // failed for any reason (transient network, concurrent
          // write, etc.).
          externalThreadId: thread.id,
          secret: getSecret(),
        });
      } catch (err) {
        logTurnError("sessions.upsertFromWebhook", err);
      }
    }

    if (fullAssistantText) {
      try {
        await fetchMutation(api.chat.persistMessagesFromWebhook, {
          agentId: agent.agentId,
          sessionExternalId,
          userMessage: message.text ?? "",
          assistantMessage: fullAssistantText,
          secret: getSecret(),
        });
      } catch (err) {
        logTurnError("persistMessagesFromWebhook", err);
      }
    }

    logTurn("complete", { textLen: fullAssistantText.length });
  } catch (err) {
    // ── Outer safety net. Anything that escaped the inner handlers
    // lands here: synchronous throws, unhandled promise rejections
    // from unwrapped awaits, Chat SDK internals throwing, etc.
    //
    // Without this catch, the error would die silently inside
    // Vercel's `after(...)` background callback because the 200
    // response to Slack has already been sent. The log line below
    // is often the ONLY indication we had that the turn failed.
    //
    // We also try to give the customer a visible error so they
    // aren't left staring at a :eyes: reaction that never turns
    // into a reply.
    logTurnError("uncaught", err);
    try {
      await markComplete("x");
    } catch {
      /* swallow */
    }
    // Route through the same failure tracker as the inner handlers
    // so a deterministic bug that consistently escapes to the outer
    // catch also triggers the auto-unsubscribe threshold instead of
    // silently re-failing on every follow-up.
    await recordFailure(
      `Sorry — something went wrong on my end. Please try again in a moment.`,
    );
  }
}

/**
 * Tee a runtime-event stream so consumers can observe text deltas
 * while the stream is still being piped to its primary consumer
 * (in this case, `thread.post(toChatStream(...))`).
 *
 * Implemented as an async generator that observes each event before
 * yielding it through. Zero buffering, single pass, single consumer
 * — the "tee" is conceptual: one observation hook + one output stream.
 *
 * `onText` fires on every non-empty `message.delta` — used to
 * accumulate the final assistant text for Convex persistence.
 *
 * **Error events are NOT watched here.** Error classification and
 * the failure signal for the handler both live in `toChatStream`
 * via its `onClassified` option, because classification needs the
 * real agent name and that's threaded in as a parameter there.
 * Keeping error handling out of this tee avoids two places that
 * both "know" about run.error.
 */
async function* teeAndAccumulate<E extends { type: string }>(
  events: AsyncIterable<E>,
  hooks: {
    onText: (text: string) => void;
    onUsage?: (usage: RuntimeUsage) => void;
  },
): AsyncGenerator<E> {
  for await (const event of events) {
    if (event.type === "message.delta") {
      const value = (event as { value?: string }).value;
      if (value) hooks.onText(value);
    } else if (event.type === "run.completed" && hooks.onUsage) {
      const usage = (event as { usage?: RuntimeUsage }).usage;
      if (usage) hooks.onUsage(usage);
    }
    yield event;
  }
}

/**
 * Best-effort persist of the classified error as an "assistant" message
 * so the web chat session view shows the same error the Slack user saw.
 * Swallowed on failure — the error is already recorded via `reportFailure`
 * in the `agentRuns` table, so losing this secondary persist is acceptable.
 */
async function persistErrorMessage(
  agentId: Id<"agents">,
  sessionExternalId: string,
  userText: string | undefined,
  assistantMessage: string,
): Promise<void> {
  try {
    await fetchMutation(api.chat.persistMessagesFromWebhook, {
      agentId,
      sessionExternalId,
      userMessage: userText ?? "",
      assistantMessage,
      secret: getSecret(),
    });
  } catch {
    // Swallow — primary error record is in agentRuns via reportFailure.
  }
}

// ── Bound handler factory ───────────────────────────────────
//
// Creates Chat SDK handlers pre-bound to a specific agent. Used by
// the Telegram multi-bot system where each agent has its own Chat
// instance and the agentId is known from the webhook URL — no
// binding-key resolution needed.

export function createBoundHandlers(agentInfo: ResolvedAgent) {
  return {
    handleMention: async (
      thread: Thread<ThreadState>,
      message: Message,
    ): Promise<void> =>
      safeHandler("mention", thread, message, async () => {
        await thread.subscribe();
        await resetConsecutiveFailures(thread);
        await runTurn(thread, message, agentInfo);
      }),

    handleSubscribed: async (
      thread: Thread<ThreadState>,
      message: Message,
    ): Promise<void> =>
      safeHandler("subscribed", thread, message, async () => {
        if (!thread.isDM && !message.isMention) return;
        await runTurn(thread, message, agentInfo);
      }),

    handleDM: async (
      thread: Thread<ThreadState>,
      message: Message,
    ): Promise<void> =>
      safeHandler("dm", thread, message, async () => {
        await thread.subscribe();
        await resetConsecutiveFailures(thread);
        await runTurn(thread, message, agentInfo);
      }),
  };
}
