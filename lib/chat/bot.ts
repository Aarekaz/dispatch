import "server-only";

import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { Chat, type Adapter } from "chat";

import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { BOT_NAME } from "@/lib/config/branding";
import { welcomeCard, helpCard, statusCard } from "@/lib/chat/cards";
import { getSecret } from "@/lib/chat/secrets";
import { handleAppHomeOpened } from "@/lib/chat/handlers/app-home";
import {
  handleAssistantContextChanged,
  handleAssistantThreadStarted,
} from "@/lib/chat/handlers/assistant";
import {
  handleDirectMessage,
  handleMention,
  handleSubscribedMessage,
} from "@/lib/chat/handlers/message";
import { createConvexState } from "@/lib/chat/state/convex-state-adapter";

function getConfiguredSlackEnv():
  | { clientId: string; clientSecret: string; signingSecret: string }
  | null {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!clientId || !clientSecret || !signingSecret) {
    return null;
  }

  return { clientId, clientSecret, signingSecret };
}

export function getMissingSlackEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.SLACK_CLIENT_ID) missing.push("SLACK_CLIENT_ID");
  if (!process.env.SLACK_CLIENT_SECRET) missing.push("SLACK_CLIENT_SECRET");
  if (!process.env.SLACK_SIGNING_SECRET) missing.push("SLACK_SIGNING_SECRET");
  return missing;
}

export function assertSlackConfigured(): void {
  const missing = getMissingSlackEnv();
  if (missing.length > 0) {
    throw new Error(
      `Slack integration is not configured. Set ${missing.join(", ")} before using Slack.`,
    );
  }
}

const configuredSlackEnv = getConfiguredSlackEnv();
const adapters: Record<string, Adapter> = {};

if (configuredSlackEnv) {
  adapters.slack = createSlackAdapter(configuredSlackEnv);
}

/**
 * Singleton Chat SDK instance for Dispatch.
 *
 * Created at module load and reused across every webhook invocation
 * within a single Vercel Fluid Compute warm instance. Concurrent
 * webhooks from different warm instances each get their own `bot`
 * singleton — coordination across instances happens via the Convex
 * state adapter (locks, dedupe, queue), not via in-process state.
 *
 * **This file deliberately registers business logic only via handler
 * delegates** — `handleMention`, `handleSubscribedMessage`, etc. all
 * live in `lib/chat/handlers/message.ts` and are platform-agnostic.
 * Adding a new platform (Telegram, Discord, Teams, etc.) is a
 * one-line change to the `adapters` map below — `pnpm add @chat-adapter/<platform>`,
 * import its factory, drop it in. The handlers themselves do not
 * change. **This is the moment "write once, deploy anywhere" earns
 * its keep.**
 *
 * Phase 1b: multi-workspace OAuth mode. The Slack adapter is
 * configured with `clientId`/`clientSecret` so it can exchange
 * OAuth codes via `handleOAuthCallback()`, and per-workspace bot
 * tokens are persisted via `setInstallation()` into our Convex
 * state adapter under `slack:installation:{teamId}` keys. The
 * webhook handler looks up the right token automatically per
 * incoming `team_id` — no per-workspace env vars needed.
 */
export const bot = new Chat({
  // BOT_NAME is env-driven from `lib/config/branding.ts`. Set
  // NEXT_PUBLIC_BOT_NAME per Vercel environment so the dev Slack
  // app ("Dispatch-Dev") and the prod app ("Dispatch") both
  // resolve correctly without code changes.
  userName: BOT_NAME,

  // Slack is optional for self-hosted installs. Register it only when
  // credentials exist so landing/control-plane deploys do not fail at build.
  adapters,

  state: createConvexState(),

  // Concurrency: queue is the right default for AI chatbots per
  // node_modules/chat/docs/concurrency.mdx:211. When a customer
  // sends a follow-up while OpenCode is mid-stream, the next handler
  // call gets `context.skipped` so it can incorporate the queued
  // messages instead of dropping them.
  //
  // queueEntryTtlMs was originally 120_000 (2 min) but we observed
  // symptoms consistent with queued messages expiring and being
  // silently dropped under real load — specifically when a long
  // OpenCode run (up to `maxDuration` of 800s in the web chat route)
  // held the lock while follow-up messages queued up and timed out.
  // Bumped to 15 minutes, which is longer than any plausible
  // single turn but short enough to clean up abandoned queue
  // entries in a reasonable window.
  concurrency: {
    strategy: "queue",
    maxQueueSize: 10,
    queueEntryTtlMs: 900_000,
  },

  // Bumped from the default 5 minutes to 15 minutes — Convex
  // round-trip latency on the dedupe `setIfNotExists` path means
  // a stricter window risks marking real retries as fresh events
  // under load. Generous TTL is cheap; missed dedupe is expensive.
  dedupeTtlMs: 900_000,

  // Placeholder shown before the first stream chunk arrives on
  // adapters that fall back to post-and-edit streaming (Telegram,
  // Discord, GChat, Teams). Slack uses native chatStream so this
  // doesn't affect Slack — but the moment we ship Telegram or
  // Discord, it matters. Defaults to "..." which reads as an
  // unlabeled ellipsis; "Thinking…" tells the user what's happening.
  fallbackStreamingPlaceholderText: "Thinking…",

  logger: "info",
});

// ── Message handlers (platform-agnostic; all 3 delegate to runTurn
// in lib/chat/handlers/message.ts) ───────────────────────────
bot.onNewMention(handleMention);
bot.onSubscribedMessage(handleSubscribedMessage);
bot.onDirectMessage(handleDirectMessage);

// ── Slack Assistants API handlers (side-panel experience) ────
// These fire only for Slack assistants-panel threads and are
// no-ops for other platforms. The Assistants API requires the
// `assistant:write` scope + `assistant_thread_started` and
// `assistant_thread_context_changed` bot events in the Slack
// app manifest (see note at the bottom of this file).
bot.onAssistantThreadStarted(handleAssistantThreadStarted);
bot.onAssistantContextChanged(handleAssistantContextChanged);

// ── Slack App Home handler ───────────────────────────────────
// Fires when a user opens the bot's profile in the Apps sidebar
// and clicks the Home tab. Publishes a branded welcome view with
// quick-start instructions.
bot.onAppHomeOpened(handleAppHomeOpened);

// ── Auto-welcome on channel invite ───────────────────────────
// When the bot itself is invited to a new channel (via /invite
// @Dispatch-Dev), post a one-time welcome message explaining
// how to interact with it. Events where OTHER users joined the
// channel are ignored — we only care about our own bot user.
//
// This handler is inline rather than a separate file because it
// needs direct access to the `bot` variable defined in this
// module, and pulling it in via Chat.getSingleton() would add
// module-load ordering concerns for no real benefit at this size.
bot.onMemberJoinedChannel(async (event) => {
  // Only react when the joining user is our own bot. The
  // adapter exposes `botUserId` once init has resolved it.
  const botUserId = event.adapter.botUserId;
  if (!botUserId || event.userId !== botUserId) return;

  try {
    const channel = bot.channel(event.channelId);
    await channel.post(welcomeCard());
  } catch (err) {
    console.warn(
      "[chat-sdk] onMemberJoinedChannel welcome post failed:",
      err instanceof Error ? err.message : err,
    );
  }
});

// ── Card action handlers ────────────────────────────────────
// Handle button clicks from the interactive cards defined in
// `lib/chat/cards.tsx`. Each action ID corresponds to a button
// in a card. The event carries the thread context so we can
// respond inline.

bot.onAction("sc-help", async (event) => {
  if (!event.thread) return;
  const agentName = BOT_NAME;
  await event.thread.post(helpCard(agentName));
});

bot.onAction("sc-status", async (event) => {
  if (!event.thread) return;

  // Look up the real agent bound to this channel by walking the
  // same binding-key precedence as the message handler.
  const platform = event.adapter.name;
  const channelId = event.thread.channelId;

  // Try channel-scoped first, then workspace-scoped (Slack only).
  const raw = event.raw as Record<string, unknown> | undefined;
  const teamId =
    (raw?.team as Record<string, unknown>)?.id as string | undefined;
  const candidates = [
    `chan:${channelId}`,
    ...(teamId ? [`team:${teamId}`] : []),
  ];

  for (const bindingKey of candidates) {
    try {
      const agent = await fetchQuery(api.integrations.findByBinding, {
        platform,
        channelBinding: bindingKey,
        secret: getSecret(),
      });
      if (agent) {
        const shortModel = agent.model?.split("/").pop() ?? "";
        await event.thread.post(
          statusCard(agent.agentName, {
            status: "running",
            model: shortModel,
            permissions: agent.toolPermissions ?? "balanced",
          }),
        );
        return;
      }
    } catch {
      // Binding lookup failed — try next candidate.
    }
  }

  // Fallback if no binding found.
  await event.thread.post(
    statusCard(BOT_NAME, {
      status: "running",
      model: "",
      permissions: "balanced",
    }),
  );
});

/*
 * ── Slack app manifest requirements ──────────────────────────
 *
 * The app manifest (configured via api.slack.com → your app → App
 * Manifest) MUST include the settings below for the features wired
 * in this file to work. After any manifest change, reinstall the
 * app to the workspace or the changes won't take effect.
 *
 *   oauth_config.scopes.bot:
 *     - app_mentions:read            # receive `app_mention` events (CRITICAL)
 *     - chat:write                   # post messages
 *     - im:history                   # DM history + events
 *     - mpim:history                 # group DM history + events
 *     - channels:read                # channel metadata lookup
 *     - groups:read                  # private-channel metadata lookup
 *     - users:read                   # author resolution
 *     - reactions:read               # onReaction events
 *     - reactions:write              # :eyes: / :white_check_mark: feedback
 *     - assistant:write              # setAssistantStatus/Prompts/Title, streaming
 *     - search:read.public           # agent-driven `search.messages` via bash
 *                                    # (see buildBootstrapPrompt's Slack capability block)
 *
 *   settings.event_subscriptions.bot_events:
 *     - app_mention                  # @-mentions in channels (CRITICAL)
 *     - message.im                   # DMs (onDirectMessage)
 *     - message.mpim                 # group DMs
 *     - app_home_opened              # onAppHomeOpened
 *     - assistant_thread_started     # onAssistantThreadStarted
 *     - assistant_thread_context_changed  # onAssistantContextChanged
 *     - member_joined_channel        # onMemberJoinedChannel auto-welcome
 *
 *   features.app_home:
 *     home_tab_enabled: true
 *     messages_tab_enabled: true
 *     messages_tab_read_only_enabled: false
 *
 * ⚠️ DO NOT SUBSCRIBE TO: message.channels, message.groups
 *
 * Subscribing to `message.channels` or `message.groups` causes a
 * hard-to-diagnose race where the bot receives BOTH `message.*` and
 * `app_mention` events for the same user @-mention. Both share the
 * same `ts` (message timestamp), and Chat SDK's dedupe key is
 * `dedupe:slack:${message.id}` where `message.id` derives from `ts`.
 * Whichever event Slack delivers first wins the dedupe slot:
 *
 *   - If `message.channels` arrives first: `event.type === "message"`,
 *     so the adapter sets `isMention = false`. Chat SDK logs
 *     "No handlers matched", releases the lock. The subsequent
 *     `app_mention` event hits dedupe and is silently dropped.
 *     **Result: bot never replies, no error logged, silent failure.**
 *
 *   - If `app_mention` arrives first: works correctly, but you can't
 *     rely on Slack's event ordering — it's non-deterministic.
 *
 * Channel @-mentions work correctly via `app_mention` alone. Non-
 * mention channel messages are explicitly ignored by our handler
 * (see `handleSubscribedMessage` in `lib/chat/handlers/message.ts`),
 * so `message.channels` subscription is pure downside.
 *
 * Non-mention DM messages ARE wanted (users expect DMs to respond to
 * every message), which is why `message.im` and `message.mpim` stay
 * subscribed — they don't conflict with `app_mention` because
 * `app_mention` never fires in DM contexts.
 */

/**
 * Typed accessor for the Slack adapter — used by the OAuth install
 * and callback routes to call `handleOAuthCallback()` and
 * `setInstallation()` directly without losing type information.
 */
export function getSlackAdapter(): SlackAdapter {
  assertSlackConfigured();
  return bot.getAdapter("slack") as SlackAdapter;
}

/**
 * Ensure the Chat SDK bot is initialized.
 *
 * Chat SDK lazy-initializes on the first webhook via
 * `bot.webhooks.<platform>(request)`, which plugs each adapter into
 * the state adapter. Our OAuth callback and the Slack-pick page
 * call adapter methods DIRECTLY (`handleOAuthCallback`,
 * `getInstallation`) without going through the webhook handler, so
 * the lazy init never fires and adapter methods throw
 * `ValidationError: Adapter not initialized`.
 *
 * This helper memoizes `bot.initialize()` so:
 *   1. The first caller triggers the real init
 *   2. Concurrent callers (e.g. parallel /api/slack/callback hits)
 *      all await the same promise — no duplicate init, no races
 *   3. Every subsequent call is effectively free
 *
 * Call this at the top of any non-webhook entry point that uses
 * `getSlackAdapter()` or similar. Webhook routes don't need it —
 * Chat SDK handles their init path automatically.
 */
let initPromise: Promise<void> | null = null;
export async function ensureBotInitialized(): Promise<void> {
  assertSlackConfigured();
  if (!initPromise) {
    initPromise = bot.initialize().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
}
