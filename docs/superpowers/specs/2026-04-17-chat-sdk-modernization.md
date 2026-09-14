# Chat SDK Modernization — Full Plan

**Date:** 2026-04-17
**Status:** Plan (not started)
**Owner:** Anurag (vaaros)

---

## TL;DR

Make **Chat SDK** the single source of truth for all Slack/Telegram I/O.
Drop **Composio**'s overlap with chat channels. Adopt the new 2026 Slack + Chat SDK
capabilities (AI thinking blocks, rich Block Kit, delayed events, durable
sessions, native Slack search).

**Immediate concern resolved:** The LLM currently may see Composio's
`slack_send_message` / `telegram_send_message` tools if those toolkits are
enabled. In chat reply contexts this risks double-posting (Chat SDK already
sends the reply). In automation contexts there's a prompt-level `deliveryHint`
that's unreliable. Hiding these from the tool catalog at the session layer
eliminates the risk entirely.

**Estimated effort:** 2–3 weeks across 6 phases. Phases 1, 2, 4, 6 are
committed. Phases 3, 5 are deferred unless a specific use case materializes.

---

## Problem statement

Three independent systems currently overlap in a confusing way:

1. **AI SDK** (`ai@^6`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/gateway`,
   `@assistant-ui/react-ai-sdk`) — UI streaming protocol for the **web chat**
   only. Defines UIMessage shape and the streaming chunks the browser consumes.

2. **Chat SDK** (`chat@^4`, `@chat-adapter/slack`, `@chat-adapter/telegram`)
   — multi-platform chat: receives webhooks, dispatches handlers, delivers
   replies via `thread.post()`. Covers Slack and Telegram fully (both listen
   and reply). Chat SDK state stored in `chatKv` table.

3. **Composio** (remote MCP server) — the agent's external tool catalog.
   ~1,247 toolkits including Gmail, Notion, Linear, GitHub, Calendar, Drive,
   **and overlapping Slack/Telegram toolkits** that provide send/search/etc
   actions.

The overlap: Composio's Slack and Telegram toolkits duplicate capabilities
Chat SDK already handles (sending messages in a thread is Chat SDK's job; the
Composio `slack_send_message` tool calls Slack's Web API a second time).

### Verified by code trace

* Chat SDK's `thread.post()` in `handleMention`
  (`lib/chat/handlers/message.ts`) is what posts the agent's reply in Slack.
* Automation output delivery (`lib/automations/delivery.ts`) uses
  `postInThread()` — **direct** Slack Web API call using the Chat SDK bot
  token. Never calls Composio.
* Composio Slack toolkit actions (`slack_send_message`, `slack_search_messages`,
  etc.) **are registered but never invoked anywhere in the codebase**.
* The auto-connect bridge (`lib/composio/auto-connect-slack.ts`) injects the
  Chat SDK bot token into Composio as a connected account — exists, but its
  only purpose was to save users a second OAuth. With Slack removed from the
  Composio catalog, this bridge becomes dead code.

### The risk without this plan

If an agent has `slack` in `composioToolkits` (legacy agents do) and is invoked
in a Slack conversation, the LLM sees `slack_send_message` in its tool
catalog and may call it to "post a response" — resulting in:

* **Double posts** (Chat SDK delivers + Composio tool delivers)
* **Wrong-channel posts** (agent in web chat invokes Slack tool, message
  goes to Slack unrelated to the current conversation)
* **Mismatched permissions** (Composio's OAuth has different scopes than
  Chat SDK's bot)

The `deliveryHint` currently injected in automation prompts
(`lib/automations/invoke.ts:282`) is a prompt-level mitigation that is
unreliable — LLMs do not obey forbidden-tool instructions consistently.

---

## Architecture — current state (verified)

```
                    ┌─ Web browser ─┐
                    │ assistant-ui  │
                    └──────┬────────┘
                           │ (AI SDK stream, UIMessage format)
                           ▼
                    ┌──────────────────────────┐
                    │ Next.js API routes       │
                    │  /api/agents/[id]/chat   │ ← web chat
                    │  /api/webhooks/[plat]    │ ← slack/telegram webhooks
                    │  /api/automations/[id]/run │ ← cron automations
                    └──────┬───────────────────┘
                           │ ensureAgentRunning()
                           ▼
                    ┌──────────────────────────┐
                    │ OpenCode runtime         │
                    │ (Daytona sandbox)        │
                    │                          │
                    │ Native tools: bash,      │
                    │   fetch, file edit, etc. │
                    │                          │
                    │ Remote MCP → Composio    │
                    │   Tool Router (gated by  │
                    │   agent.composioToolkits)│
                    └──────┬───────────────────┘
                           │ RuntimeEvent stream
                           ▼
           ┌───────────────┼───────────────────────────┐
           ▼               ▼                           ▼
    ┌─ toUIMessage ─┐  ┌─ toChatStream ─┐     ┌─ deliverOutput ─┐
    │  (AI SDK)     │  │  (Chat SDK)    │     │ (direct API)    │
    │ → browser     │  │ → thread.post  │     │ → Slack API     │
    └───────────────┘  │ → Slack/TG     │     │ → via chatKv    │
                       └────────────────┘     │    bot token    │
                                              └─────────────────┘
```

### Key data paths

| Input | Entry point | Runtime | Output delivery |
|---|---|---|---|
| Web chat message | `/api/agents/[id]/chat` | OpenCode | AI SDK UIMessage stream |
| Slack message | `/api/webhooks/slack` → Chat SDK | OpenCode | `thread.post()` |
| Telegram message | `/api/webhooks/telegram` → Chat SDK | OpenCode | `thread.post()` |
| Cron automation | `/api/automations/[id]/run` | OpenCode | `deliverOutput()` (direct Slack API via `postInThread()`) |

### Tool exposure at runtime

The LLM sees:
1. **Native OpenCode tools** — `bash`, `fetch`, `browser`, `write`, `edit`,
   `read`, `glob`, `grep`. Always available.
2. **Composio MCP tools** — whatever toolkits are in `agent.composioToolkits`.
   Plus four meta-tools: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`,
   `COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_MANAGE_CONNECTIONS`.

The filter point: `lib/composio/session.ts:getComposioMcpConfig({ toolkits })`
takes the raw `agent.composioToolkits` array. If `slack` / `telegram` are not
in that array, the MCP server does not expose Slack/Telegram actions.

---

## User cases — exhaustively traced

### Case A: Web chat, no tools
Browser → `/api/agents/[id]/chat` → OpenCode → LLM → text stream → browser.
**Clean.** No changes needed.

### Case B: Web chat, agent calls Gmail
Same as A plus OpenCode invokes Composio MCP for `gmail_send_email`.
**Clean.** No changes needed.

### Case C: Slack message → agent replies
Slack → webhook → `handleMention` → OpenCode → stream → `thread.post()` → Slack.
**At risk** if `slack` is in `composioToolkits`: LLM could call
`slack_send_message` redundantly. Fixed by Phase 1.

### Case D: Cron automation → posts to Slack
Cron → `invokeAutomation` → OpenCode → text output → `deliverOutput()` →
`postInThread()` → Slack Web API.
**Protected** by existing `deliveryHint` but unreliable. Fixed robustly by
Phase 1.

### Case E: Web chat, user asks agent to post to Slack channel
Currently: agent would call `slack_send_message` if toolkit enabled.
After Phase 1: agent has no way to do this ad-hoc.
Phase 4 adds a framework-native `search_slack_messages` + `post_to_slack_channel`
tool using the Chat SDK bot token.

### Case F: Agent needs to search Slack history
"Find the conversation from last week about API redesign."
Currently: only via Composio's `slack_search_messages`.
Phase 4 adds a native tool using Slack's Real-time Search API with the
new granular scope `search:read.public`.

---

## What's new in 2026 (reference material)

### Slack platform updates

| Date | Change | Relevance |
|---|---|---|
| 2026-04-16 | New Block Kit blocks: Alert, Card, Carousel | Richer reply formatting (Phase 2) |
| 2026-03-30 | PKCE generally available | Optional — more secure OAuth |
| 2026-03-16 | Optional OAuth scopes (`bot_optional` / `user_optional`) | Simpler install flow (Phase 2) |
| 2026-03-06 | Rich markdown in Block Kit: code blocks, tables, task lists | Better formatting (Phase 2) |
| 2026-03-05 | `assistant.threads.setStatus` accepts `chat:write` | Can drop `assistant:write` scope (Phase 2) |
| 2026-02-17 | Granular Search scopes (`search:read.public`, etc.) | Enables Phase 4 native search |
| 2026-02-11 | AI thinking blocks: `task_card`, `url_source`, `plan` + `task_display_mode` in streaming API | Phase 2 — native reasoning display |
| 2026-02-05 | Delayed Events retry | Phase 6 — reliability |

### Chat SDK guide additions

1. **Slack + Next.js guide** (<https://chat-sdk.dev/docs/guides/slack-nextjs>)
   — confirms current setup. Uses `bot.onNewMention()`, `thread.subscribe()`,
   `bot.onSubscribedMessage()`. Interactive messages via JSX
   (`<Card>`, `<Button>`, `<Actions>`). Requires `.tsx` + `"jsx": "react-jsx"`
   (we already have this).

2. **Durable chat sessions** (<https://chat-sdk.dev/docs/guides/durable-chat-sessions-nextjs>)
   — Chat SDK + Vercel Workflow. Workflows pause between user turns via
   `createHook<PayloadType>()` + `resumeHook(runId, payload)`. Thread state
   stores `runId`. Conversations survive deployments, cold starts, retries.

   ```typescript
   const bot = new Chat<typeof adapters, ThreadState>({
     state: createRedisState(),
   }).registerSingleton();

   using hook = createHook<ChatTurnPayload>({ token: workflowRunId });
   await resumeHook<ChatTurnPayload>(state.runId, { message: message.toJSON() });
   ```

3. **Scheduled posts (Neon)** (<https://chat-sdk.dev/docs/guides/scheduled-posts-neon>)
   — Workflow + Postgres for scheduling. `createScheduledPost()` stores
   metadata, `sendScheduledPost()` is a workflow that sleeps until the target
   time, then publishes. Supports cancellation and rescheduling. Does NOT
   introduce new Chat SDK methods — uses existing `bot.channel().post()`.

### Slack docs changelog

Source: <https://docs.slack.dev/changelog/>

---

## The plan — 6 phases

### Dependencies & environment

**New packages** (across phases):

| Package | Phase | Purpose |
|---|---|---|
| Latest `chat@^4.x`, `@chat-adapter/slack@^4.x` | 2 | New Block Kit types, `task_display_mode`, thinking blocks |
| `@vercel/workflow` | 3, 5 | Durable sessions + scheduled posts |
| `@neondatabase/serverless` OR `@vercel/postgres` | 5 | Schedule storage |

**Slack app manifest changes**:

* Phase 2 — drop `assistant:write`, keep `chat:write`
* Phase 4 — add `search:read.public` scope
* Phase 6 — enable delayed events retry subscription + retry URL

**Environment variables**:

| Var | Phase | Purpose |
|---|---|---|
| `DATABASE_URL` (Neon Postgres) | 5 | Scheduled post storage |
| `WORKFLOW_REDIS_URL` | 3 | `@vercel/workflow` runtime state |

---

### Phase 1 — Strip Composio chat overlap + delivery hint
**Status:** Committed. **Effort:** 30 minutes. **Risk:** Very low.

#### Goal
Eliminate the double-post risk by preventing the LLM from seeing Composio's
Slack/Telegram tools. Also defend against legacy agents that already have
those toolkits in their array.

#### Files to change

```
app/(workspace)/[agentId]/connect/page.tsx
  └── Filter `slack` and `telegram` out of the Composio catalog:
      const CHAT_SDK_CHANNELS = new Set(["slack", "telegram"]);
      const filtered = catalog.filter(t => !CHAT_SDK_CHANNELS.has(t.slug));

lib/composio/session.ts
  └── Defensive filter in getComposioMcpConfig — strip the same slugs
      from `toolkits` before passing to composio.create(). Protects
      agents that already have `slack` in their composioToolkits array.

lib/chat/handlers/message.ts (handleMention)
  └── Inject a delivery hint into the agent's prompt:
      "You're replying in Slack. Your text response is automatically
      delivered to this thread. Do not call slack_send_message —
      just write your reply as plain text."
  └── Same treatment for Telegram handler path.
```

#### Acceptance criteria

* [ ] Connect page shows no Slack or Telegram toolkit rows in the Composio
  catalog
* [ ] Manual QA: agent with `slack` in its `composioToolkits` does NOT call
  `slack_send_message` when invoked in a Slack conversation
* [ ] Existing channel connections (Slack/Telegram via Chat SDK OAuth)
  continue to function
* [ ] Existing non-chat toolkits (Gmail, Notion, Linear, etc.) unaffected
* [ ] Automation delivery to Slack continues to work

#### Rollback
Revert the three files. No data migration. Instant.

---

### Phase 2 — Slack AI thinking blocks + rich Block Kit
**Status:** Committed. **Effort:** 1–2 days. **Risk:** Low–Medium.

#### Goal
When the agent streams reasoning content (`reasoning.delta` events), render it
in Slack as native `task_card` + `plan` blocks instead of inline plain text.
Use the `task_display_mode` parameter in `chat.startStream`. Adopt
Card/Carousel/Alert blocks for tool results and errors.

#### Prerequisites

1. Bump `chat` and `@chat-adapter/slack` to the version that supports the
   Feb 2026 additions. Verify version compatibility.
2. Update the Slack app manifest at api.slack.com/apps:
   * Keep `chat:write` (sufficient for AI status per March 2026)
   * Drop `assistant:write` (optional cleanup — can stay during transition)

#### Files to change

```
lib/chat/stream-bridge.ts (toChatStream)
  ├── When event.type === "reasoning.delta" →
  │     emit a native task_card / plan block (with task_display_mode)
  │     instead of inlining as text
  ├── When event.type === "tool.started" →
  │     emit a Card with status "running" + tool label
  ├── When event.type === "tool.completed" →
  │     update the Card to "done" with structured output
  └── When event.type === "run.error" →
        emit an Alert block

lib/chat/handlers/message.ts
  └── Pass appropriate task_display_mode for the current context

package.json
  └── Bump chat + @chat-adapter/slack
```

#### Migration

* Slack scope changes (dropping `assistant:write`): existing installations
  keep working with the old scope set. Prompt reinstall on next major release.
* No data migration — purely rendering changes.

#### Acceptance criteria

* [ ] Agent reasoning streams as collapsible `task_card` blocks in Slack (not
  plain text)
* [ ] Tool results render as Card blocks with icon + title + body
* [ ] Errors render as Alert blocks with structured error detail
* [ ] Plain-text replies still work when agent has no reasoning or tools
* [ ] Web chat behavior unchanged (only stream-bridge.ts for Slack is
  affected, not the AI SDK bridge for web)

#### Rollback
Revert `stream-bridge.ts` — falls back to plain-text rendering. No data
impact.

---

### Phase 3 — Durable chat sessions via Vercel Workflow
**Status:** Deferred. **Effort:** 3–5 days. **Risk:** High.

#### Goal
Wrap each Slack/Telegram conversation in a Vercel Workflow. The workflow
pauses between user turns using `createHook` / `resumeHook`, preserving
agent state across deployments and cold starts.

#### Should we do this?

**Current architecture is already durable:**

* Convex persists all runs, sessions, messages
* OpenCode sandbox recovers session by ID
* Each webhook re-fetches context from Convex

Vercel Workflow durable sessions add value only when:
* A single logical interaction spans multiple user turns with in-flight state
* We need guaranteed-exactly-once turn execution
* We have multi-step approvals or form-filling flows

For basic chat reply, this is **overkill**. **Recommendation: defer until a
specific use case materializes** (e.g., approval-gated automations,
multi-step configuration wizards).

#### If we proceed — files to change

```
lib/workflow/ (new)
  ├── chat-turn.ts — the durable workflow function
  ├── types.ts — ChatTurnPayload, ThreadState extension

lib/chat/handlers/message.ts
  └── On new message: if thread.state.runId exists → resumeHook()
                      else → start(chatTurn, [...])

convex/schema.ts
  └── Extend chatKv or add workflowRuns table to track runId per thread

package.json
  └── @vercel/workflow

.env (and Vercel project env)
  └── WORKFLOW_REDIS_URL (required by @vercel/workflow runtime)
```

#### Migration

Feature-flag this path. Deploy workflow infrastructure first, flip the
handler to use it behind a flag, verify on staging, then enable in production.

Old sessions: fall through to "start new workflow" — no data loss, just no
cross-turn durability for historical conversations.

#### Acceptance criteria

* [ ] A Slack conversation survives a server restart mid-turn
* [ ] Agent state (current task, partial tool calls) is restored after restart
* [ ] Workflow cold-start adds < 500 ms overhead
* [ ] Metric: workflow failure rate is near zero during testing

#### Rollback
Feature flag off — reverts to current stateless handling.

---

### Phase 4 — Native Slack search + remove Composio Slack entirely
**Status:** Committed. **Effort:** 1–2 days. **Risk:** Low–Medium.

#### Goal
Build framework-native Slack search using the Chat SDK bot token and Slack's
Real-time Search API. Delete `auto-connect-slack.ts`. At this point, Composio
Slack is truly gone from our surface area.

#### Prerequisites

1. Update Slack app manifest to request `search:read.public` (required) and
   optionally `search:read.private`, `search:read.im`, `search:read.mpim`.
2. Users must reinstall the Slack app to grant the new scopes. Communicate
   via in-product banner / email.

#### Files to change

```
lib/chat/slack-tools.ts (new)
  ├── searchSlackMessages(teamId, query) — uses bot token from chatKv
  └── postToSlackChannel(teamId, channelId, text) — cross-channel ad-hoc
      post (covers Case E from user-case analysis)

lib/runtime/native-tools.ts (new or extend existing)
  └── Register search_slack_messages as an OpenCode-native tool
  └── Register post_to_slack_channel similarly
  └── Tools are only surfaced to agents with an active Slack channel binding

Deleted:
  lib/composio/auto-connect-slack.ts
  lib/composio/auto-connect-telegram.ts (optional — same logic)
  app/api/composio/auto-connect-slack/route.ts
  app/api/composio/auto-connect-telegram/route.ts

convex/integrations.ts
  └── No schema changes — bot tokens still live in chatKv
```

#### Migration

* Users with existing Slack installs prompted to reinstall for new scopes.
  One-time friction; provide a banner + "Upgrade Slack connection" button.
* Old agents with `slack` in `composioToolkits`: unaffected at runtime
  (already filtered by Phase 1). Optionally strip from DB in a cleanup
  migration.

#### Acceptance criteria

* [ ] Agent in Slack can successfully call `search_slack_messages("query")` and
  receive results
* [ ] Agent in web chat can call `post_to_slack_channel(channelId, text)` to
  post to a channel the bot is a member of
* [ ] Tools are NOT surfaced to agents without a Slack channel binding
* [ ] `auto-connect-slack.ts` and related routes are deleted
* [ ] Composio catalog no longer shows `slack` row (already from Phase 1)

#### Rollback
Revert the PR. Users can re-enable Composio Slack in the interim (requires
un-filtering the Composio catalog).

---

### Phase 5 — Scheduled posts via Workflow + Postgres
**Status:** Deferred. **Effort:** 2–3 days. **Risk:** Medium.

#### Goal
Replace automation-output `postInThread()` with the Vercel Workflow + Neon
Postgres pattern from the Chat SDK guide. Adds cancellation, rescheduling,
and approval hooks to automation deliveries.

#### Should we do this?

**Current automation delivery works** — `postInThread()` with the Chat SDK
bot token delivers reliably. Workflow + Postgres adds:

* Cancellable schedules (delete a future-dated post before it sends)
* Reschedulable schedules (update the send time)
* Approval hooks (gate posts behind an approver)

**Defer unless users request any of these.** Current cron-based automation
covers the common case.

#### If we proceed — files to change

```
lib/scheduling/ (new)
  ├── create-scheduled-post.ts
  ├── cancel-scheduled-post.ts
  ├── send-scheduled-post.ts (workflow function)
  └── reschedule-post.ts

convex/scheduledPosts.ts OR Neon Postgres table
  └── Schedule metadata source of truth

lib/automations/delivery.ts
  └── Route automation outputs through createScheduledPost() instead of
      direct postInThread()

package.json
  └── @neondatabase/serverless or @vercel/postgres

.env (and Vercel project env)
  └── DATABASE_URL (Neon connection string)
```

#### Acceptance criteria

* [ ] Automation scheduled for +5 minutes in the future posts successfully
* [ ] Cancelling the automation deletes the pending workflow
* [ ] Workflow survives server restart during its sleep period
* [ ] Immediate-post automations still work (bypass the scheduler)

#### Rollback
Feature flag on the delivery path — falls back to direct `postInThread()`.

---

### Phase 6 — Delayed Events retry
**Status:** Committed. **Effort:** 1 day. **Risk:** Very low.

#### Goal
Implement Slack's Feb 2026 Delayed Events feature so our webhook endpoint
can catch up on events missed during server outages. Slack retries events
to a designated URL when the primary webhook returns non-200.

#### Files to change

```
app/api/webhooks/slack/retry/route.ts (new)
  ├── POST handler that validates Slack signature
  └── Processes events identically to the main webhook — idempotent via
      Chat SDK state

Slack app manifest (api.slack.com/apps)
  └── Enable "Retry delayed events" feature
  └── Set retry URL: https://<domain>/api/webhooks/slack/retry

lib/chat/bot.ts
  └── Verify Chat SDK processes replayed events idempotently (event_id
      deduplication). Add tests if needed.
```

#### Acceptance criteria

* [ ] Simulate a webhook outage (bring main handler down for 30 seconds with
  test traffic)
* [ ] After recovery, Slack replays events to the retry URL
* [ ] All missed messages are processed exactly once (verify via Convex log)

#### Rollback
Remove retry URL from Slack manifest. No code rollback needed — endpoint can
remain.

---

## Execution order

```
Week 1
├── Day 1: Phase 1 (30 min) — ship + verify in prod
├── Day 2–3: Phase 2 (thinking blocks + rich Block Kit)
└── Day 4–5: Phase 4 (native Slack search, retire Composio Slack)

Week 2
├── Day 6: Phase 6 (delayed events retry)
└── Day 7–12: Phase 3 or Phase 5 (only if justified by product signal)

Week 3
└── Buffer for bug fixes, migration communication, staging QA.
```

**Critical path:** Phase 1 → Phase 2 → Phase 4. Phases 3, 5, 6 can be
deferred or dropped based on product priorities.

---

## Risk summary

| Phase | Risk | Mitigation |
|---|---|---|
| 1 | Very low | Three-file change, fully revert-able |
| 2 | Low–Medium | Pin Chat SDK + Slack adapter versions; QA rendering on staging |
| 3 | High | New infra + state migration; gate with feature flag |
| 4 | Low–Medium | User reinstall required for new scope; communicate proactively |
| 5 | Medium | New Postgres dep; only proceed if cancellation/approval needed |
| 6 | Very low | Additive endpoint; idempotency via Chat SDK state |

---

## Commit plan

**Today:**
* Phase 1 in a single commit, push to `ux-revamp` branch

**Near-term (this week/next week):**
* Phase 2 in its own PR — focused on stream-bridge + Chat SDK version bump
* Phase 4 in its own PR — includes Slack manifest changes + migration
  communication

**Later (if justified):**
* Phase 6 — small PR, easy merge
* Phases 3 and 5 — full design review before implementation

---

## Open questions

1. **Phase 3 — do we need durable multi-turn state?** Ask the team: are there
   planned use cases that require pausable multi-turn conversations? Approval
   flows? Multi-step form filling?

2. **Phase 5 — do users need cancellable schedules?** Review user feedback
   and support tickets. If nobody has asked for it, defer.

3. **Chat SDK version** — what version supports the Feb 2026 Slack additions?
   Check release notes of `chat@^4` and `@chat-adapter/slack@^4`. May need
   to wait for a specific release or open an issue.

4. **User migration for Phase 4 (new OAuth scope)** — how do we communicate
   the reinstall? In-product banner on the Connect page? Email? Auto-detect
   and prompt on next Slack interaction?

5. **Dead code cleanup** — after Phase 4, do we remove the
   `composioToolkits: ["slack"]` entries from existing agent records via a
   Convex migration, or leave them as harmless data?

---

## Reference material

* Slack changelog: <https://docs.slack.dev/changelog/>
* Slack AI developing agents: <https://docs.slack.dev/ai/developing-agents#streaming>
* Slack Block Kit: <https://docs.slack.dev/block-kit/>
* Chat SDK — Slack + Next.js: <https://chat-sdk.dev/docs/guides/slack-nextjs>
* Chat SDK — Durable chat sessions: <https://chat-sdk.dev/docs/guides/durable-chat-sessions-nextjs>
* Chat SDK — Scheduled posts: <https://chat-sdk.dev/docs/guides/scheduled-posts-neon>
* Vercel Workflow: <https://vercel.com/docs/workflow>
* Composio docs: <https://docs.composio.dev>

---

## Appendix — relevant code locations (as of 2026-04-17)

| Area | File | Key function / section |
|---|---|---|
| Web chat entry | `app/api/agents/[id]/chat/route.ts` | `POST` handler, `createUIMessageStream` |
| Slack webhook | `app/api/webhooks/slack/route.ts` | Routes to `lib/chat/bot.ts` |
| Chat SDK bot | `lib/chat/bot.ts` | `new Chat()`, adapters, singletons |
| Slack reply handler | `lib/chat/handlers/message.ts` | `handleMention`, `runTurn` |
| Stream bridges | `lib/runtime/ai-sdk-bridge.ts` (web), `lib/chat/stream-bridge.ts` (platforms) | `toUIMessageStream`, `toChatStream` |
| OpenCode adapter | `lib/runtime/opencode.ts` | `OpenCodeRuntimeAdapter`, event loop |
| Ensure running | `lib/agents/ensure-running.ts` | `ensureAgentRunning`, `buildOpenCodeConfig` |
| Composio session | `lib/composio/session.ts` | `getComposioMcpConfig` |
| Composio connect | `lib/composio/connect.ts`, `app/api/composio/connect/route.ts` | `initiateConnection` |
| Auto-connect Slack | `lib/composio/auto-connect-slack.ts`, `app/api/composio/auto-connect-slack/route.ts` | `tryAutoConnectSlack` |
| Automation invocation | `lib/automations/invoke.ts` | `invokeAutomation`, `deliveryHint` |
| Automation delivery | `lib/automations/delivery.ts`, `lib/automations/slack-api.ts` | `deliverOutput`, `postInThread` |
| Connect page UI | `app/(workspace)/[agentId]/connect/page.tsx` | `ConnectPage`, catalog filter point |
| Connect row components | `components/connect/channel-action.tsx`, `components/connect/toolkit-action.tsx` | Action handlers |
| Schema | `convex/schema.ts` | `agents`, `agentIntegrations`, `chatKv`, `agentMemoryFiles` |
