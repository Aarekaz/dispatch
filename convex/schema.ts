import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // App-level user profile keyed by Better Auth user id.
  userProfiles: defineTable({
    userId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    subscriptionTier: v.optional(v.string()),
    creditsBalance: v.optional(v.number()),
    // User profile & personalization
    nickname: v.optional(v.string()),
    company: v.optional(v.string()),
    industry: v.optional(v.string()),
    background: v.optional(v.string()),
    customInstructions: v.optional(v.string()),
    timezone: v.optional(v.string()),
    // Opt-in UI sound effects (message arrived, artifact announced).
    // Off by default — UI sounds are polarizing. Toggle lives in the
    // UserSettingsPopover footer-adjacent row.
    soundEnabled: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  agents: defineTable({
    userId: v.string(),
    teamId: v.optional(v.id("teams")),
    organizationId: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    vertical: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    volumeId: v.optional(v.string()),
    serverPassword: v.optional(v.string()),
    model: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("idle"),
      v.literal("draft"),
      v.literal("attention"),
    ),
    emoji: v.optional(v.string()),
    persona: v.optional(v.string()),
    email: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    toolPermissions: v.optional(
      v.union(
        v.literal("conservative"),
        v.literal("balanced"),
        v.literal("permissive"),
      ),
    ),
    // Composio toolkit slugs this agent has access to (e.g. ["gmail","linear"]).
    // Optional so existing rows don't need backfill. Connections themselves
    // live in Composio scoped to `${userId}:${agentId}` — we only store the
    // enabled-toolkit whitelist here.
    composioToolkits: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_team", ["teamId"])
    .index("by_user_slug", ["userId", "slug"]),

  teams: defineTable({
    name: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.string(),
    role: v.string(),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"]),


  // ── Automations framework ───────────────────────────────
  //
  // Automations framework: agents run prompts on triggers, deliver
  // that can be triggered by schedules (cron), events (channel
  // scanner, webhooks), or manually. Each automation = one agent
  // turn with one prompt. The agent's own tool loop handles
  // multi-step execution via Composio.
  //
  // output somewhere, and log what happened.

  agentAutomations: defineTable({
    agentId: v.id("agents"),
    userId: v.string(),

    name: v.string(),
    slug: v.string(),
    enabled: v.boolean(),

    // When it runs — arrays capped at 3 each (enforced at app layer)
    schedules: v.array(
      v.object({
        id: v.string(),
        cron: v.string(),
        timezone: v.string(),
      }),
    ),
    triggers: v.array(
      v.object({
        id: v.string(),
        type: v.string(), // "slack.channel_scanner" | future types
        label: v.optional(v.string()),
        config: v.any(),
      }),
    ),

    // What it does
    instructions: v.string(),

    // Scope narrowing — subset of the agent's Composio toolkits.
    // Omitted or empty = inherit full agent toolkit set.
    // Validated on write: must be a subset of agent.composioToolkits.
    allowedToolkits: v.optional(v.array(v.string())),

    // Where the output goes
    defaultDelivery: v.optional(
      v.object({
        type: v.union(
          v.literal("activity_log"),
          v.literal("slack_channel"),
          v.literal("telegram_channel"),
          v.literal("slack_thread"),
        ),
        config: v.optional(v.any()),
      }),
    ),

    // Bookkeeping (denormalized for cheap list-page reads)
    lastRunAt: v.optional(v.number()),
    lastRunStatus: v.optional(
      v.union(
        v.literal("success"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    runCount: v.optional(v.number()),
    nextScheduleAt: v.optional(v.number()),

    // Persistent OpenCode session ID for this automation. All runs
    // reuse the same session so the agent has memory across runs.
    // Created on first run, reused on subsequent runs.
    persistentSessionId: v.optional(v.string()),

    // Scanner-specific: tracks per-trigger last scan time so late
    // cron ticks don't drop coverage. Keyed by trigger id.
    scannerLastScanAt: v.optional(v.record(v.string(), v.number())),

  })
    // `by_agent` removed — it's a prefix of `by_agent_and_slug`.
    // Queries filtering only on agentId can use by_agent_and_slug
    // without specifying the slug condition.
    .index("by_user", ["userId"])
    .index("by_enabled_and_nextSchedule", ["enabled", "nextScheduleAt"])
    .index("by_agent_and_slug", ["agentId", "slug"]),

  agentAutomationRuns: defineTable({
    automationId: v.id("agentAutomations"),
    agentId: v.id("agents"),

    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),

    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("skipped"),
    ),

    triggerKind: v.union(
      v.literal("manual"),
      v.literal("schedule"),
      v.literal("trigger"),
    ),
    triggerDetail: v.optional(v.string()),

    delivery: v.optional(
      v.object({
        type: v.union(
          v.literal("activity_log"),
          v.literal("slack_channel"),
          v.literal("telegram_channel"),
          v.literal("slack_thread"),
        ),
        config: v.optional(v.any()),
      }),
    ),

    output: v.optional(v.string()),
    summary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_automation", ["automationId"])
    .index("by_automation_and_startedAt", ["automationId", "startedAt"])
    .index("by_agent_and_startedAt", ["agentId", "startedAt"]),

  agentIntegrations: defineTable({
    agentId: v.id("agents"),
    platform: v.union(
      v.literal("slack"),
      v.literal("telegram"),
      v.literal("whatsapp"),
      v.literal("discord"),
      v.literal("email"),
    ),
    encryptedConfig: v.string(),
    channelBinding: v.optional(v.string()),
  })
    .index("by_agent", ["agentId"])
    .index("by_binding", ["channelBinding"]),

  // Agent memory files — durable Convex backup of sandbox filesystem memory.
  // Source of truth is the sandbox when running; Convex when stopped.
  // Synced by lib/agents/memory-sync.ts in the background.
  agentMemoryFiles: defineTable({
    agentId: v.id("agents"),
    path: v.string(),
    name: v.string(),
    type: v.string(),
    content: v.string(),
    contentHash: v.string(),
    syncedAt: v.number(),
    deletedAt: v.optional(v.number()),
    extractedFromSession: v.optional(v.string()),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_and_path", ["agentId", "path"]),

  // Mirror of the Daytona workspace tree. One row per file or directory,
  // keyed by (agentId, parentPath). When the sandbox is running, the
  // files API upserts each listing it serves so the cache stays warm.
  // When the sandbox is stopped, the UI reads from this table and shows
  // a "cached view" banner. File *contents* are NOT mirrored here — only
  // the tree structure. Viewing a file still requires waking the sandbox.
  agentWorkspaceFiles: defineTable({
    agentId: v.id("agents"),
    parentPath: v.string(),
    id: v.string(), // matches WorkspaceFile.id (base64url of full path)
    name: v.string(),
    path: v.string(),
    type: v.union(v.literal("file"), v.literal("directory")),
    size: v.optional(v.string()),
    syncedAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_and_parent", ["agentId", "parentPath"]),

  creditLedger: defineTable({
    userId: v.string(),
    agentId: v.optional(v.id("agents")),
    amount: v.number(),
    reason: v.string(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_createdAt", ["userId", "createdAt"])
    .index("by_agent", ["agentId"]),

  agentSessions: defineTable({
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    runtimeSessionId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Automation attribution — set when this session was created by an
    // automation trigger (manual, schedule, or event). The automation
    // detail page queries sessions by this field to show "recent runs."
    // Absent for normal chat sessions.
    automationId: v.optional(v.id("agentAutomations")),
    automationTrigger: v.optional(v.string()), // "manual" | "schedule" | "trigger:slack.channel_scanner"
    // Lifecycle status for automation-created sessions. Absent on
    // normal chat sessions. Enables instant UI feedback: the session
    // row appears in "pending" while the sandbox wakes, transitions
    // to "running" when the agent starts, and "completed"/"failed"
    // when done. Old sessions without this field are treated as
    // completed by the UI.
    automationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    automationError: v.optional(v.string()),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_session", ["agentId", "sessionExternalId"])
    .index("by_thread", ["threadId"])
    .index("by_automation", ["automationId"]),

  agentMessages: defineTable({
    agentId: v.id("agents"),
    sessionExternalId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    // Stored UI/runtime message parts have evolved over time
    // (text, reasoning, tool-call, notice, error). Keep the top-level
    // row schema stable and flexible so historical messages don't block
    // Convex deploys when nested part shapes grow.
    parts: v.optional(v.array(v.any())),
    createdAt: v.number(),
  }).index("by_session", ["agentId", "sessionExternalId"]),

  agentRuns: defineTable({
    agentId: v.id("agents"),
    sessionId: v.optional(v.string()),
    trigger: v.union(
      v.literal("chat"),
      v.literal("cron"),
      v.literal("webhook"),
      v.literal("manual"),
      v.literal("automation"),
    ),
    // Automation attribution — set when trigger === "automation" so the
    // per-agent activity view can show the automation name as a link.
    // `automationName` is denormalized to avoid a join on the list query.
    automationId: v.optional(v.id("agentAutomations")),
    automationName: v.optional(v.string()),
    // Where the conversation happened. Optional because internal/cron
    // runs aren't tied to a customer-facing channel. Customer-channel
    // values: "web" | "slack" | "whatsapp" | "telegram" | "email" | "discord"
    channel: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    summary: v.optional(v.string()),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    credits: v.optional(v.number()),
    startedAt: v.number(),
    // Reserved — not yet populated. Will be set when run lifecycle
    // tracking is implemented (completedAt = startedAt + duration).
    completedAt: v.optional(v.number()),
    duration: v.optional(v.string()),
    // ── Failure diagnostics ─────────────────────────────────
    //
    // Populated only when `status === "failed"`. See `lib/chat/errors.ts`
    // for the classifier that fills these. Pre-existing rows have all
    // three as undefined, so the admin-panel UI must treat them as
    // optional and fall back to generic copy.
    //
    // `errorCategory`  — stable enum string, drives UI label/guidance
    //                    lookup. See `ErrorCategory` in errors.ts.
    // `errorDetail`    — raw provider/runtime payload, pretty-printed.
    //                    Safe to show only to admins.
    // `correlationId`  — 5-char base36 ref shown to the user in Slack
    //                    AND stored here. Greppable across Vercel logs,
    //                    Convex rows, and user-reported screenshots.
    errorCategory: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    correlationId: v.optional(v.string()),
  })
    .index("by_agent", ["agentId"])
    .index("by_session", ["sessionId"])
    .index("by_correlation", ["correlationId"]),

  // ── Chat SDK state adapter tables ────────────────────────
  //
  // These five tables back the Vercel Chat SDK `StateAdapter` interface
  // (verbatim from `node_modules/chat/dist/index.d.ts:845`). They are
  // managed exclusively by `convex/chatState.ts` and proxied from the
  // Vercel webhook handlers via `lib/chat/state/convex-state-adapter.ts`.
  //
  // Treat these as Chat-SDK-internal: do NOT read or write them from
  // app-level UI code. They have their own lifecycle (lazy TTL on read +
  // scheduled cron sweep) and their own ownership semantics (locks have
  // a token, queue entries belong to a thread).
  //
  // OCC note: Convex's optimistic concurrency control is what makes
  // `acquireLock` / `setIfNotExists` correct without a Lua-script
  // equivalent. Two concurrent mutations for the same key are
  // serialized by Convex; one wins, the other retries.

  // Distributed locks. Acquired by Chat SDK before processing a webhook
  // to prevent duplicate work when the platform retries delivery.
  chatLocks: defineTable({
    // Lock key — usually a thread or channel identifier.
    key: v.string(),
    // Random token issued at acquire time. `releaseLock` only releases
    // if the token matches; force-release ignores it.
    token: v.string(),
    // Unix ms expiry. Reads check `expiresAt > now` for lazy TTL.
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  // Generic key-value store with optional TTL. Used by Chat SDK for
  // dedupe (`setIfNotExists`), thread state (`set`/`get`), and various
  // small caches.
  chatKv: defineTable({
    key: v.string(),
    // Stored as `v.any()` because Chat SDK's KV is generic over T.
    // Consumers serialize/deserialize on their side.
    value: v.any(),
    // Optional Unix ms expiry. Absent means no TTL.
    expiresAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  // Append-only lists keyed by string. Insertion order is established
  // by Convex's `_creationTime` system field, so reads use
  // `.withIndex("by_key", ...).order("asc")` and the `getList` helper
  // returns values in oldest-first order. `appendToList` trims oldest
  // entries beyond `maxLength` in the same mutation as the insert.
  chatLists: defineTable({
    key: v.string(),
    value: v.any(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  // Per-thread message queue used by the `queue` and `debounce`
  // concurrency strategies. One row per pending message. Drained
  // oldest-first by `_creationTime`. `messageJson` is the serialized
  // Chat SDK `Message` object, which is platform-specific so we store
  // it opaquely.
  chatQueue: defineTable({
    threadId: v.string(),
    // Unix ms — when the message was enqueued. Mirrors Chat SDK's
    // `QueueEntry.enqueuedAt`.
    enqueuedAt: v.number(),
    // Unix ms — when the queue entry expires. Stale entries are
    // discarded on dequeue.
    expiresAt: v.number(),
    // Serialized Chat SDK `Message`. The adapter is responsible for
    // round-tripping this through JSON.
    messageJson: v.any(),
  })
    .index("by_thread", ["threadId"])
    .index("by_expiresAt", ["expiresAt"]),

  // Persistent thread subscriptions. When a Chat SDK handler calls
  // `thread.subscribe()`, a row is inserted here so subsequent webhooks
  // for the same thread route to `onSubscribedMessage` handlers.
  chatSubscriptions: defineTable({
    threadId: v.string(),
  }).index("by_thread", ["threadId"]),
});
