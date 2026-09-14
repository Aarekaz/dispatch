# Cron Channel Delivery — Plan

**Date:** 2026-04-08
**Status:** Proposed, awaiting go-ahead
**Branch (default):** `feat/chat-sdk` (already 11 commits; bundling here vs a new branch is an open decision — see §Open Decisions)
**Related:**
- Phase 1a/1b Slack integration (landed in `feat/chat-sdk`)
- Phase 2 Telegram integration (future — this plan is explicitly designed to accommodate it)

---

## Problem

The agent cron system is fully wired end-to-end today:

- Schema: `agentCrons` table in `convex/schema.ts`
- Dispatcher: `app/api/cron/tick/route.ts` (fires on Vercel cron schedule `* * * * *`)
- UI: `components/agent-management/agent-management-schedule.tsx`
- Convex mutations: `convex/agentCrons.ts`
- API routes: `app/api/agents/[id]/crons/route.ts` + `[cronId]/route.ts`

Users can create scheduled jobs, Vercel's cron scheduler fires the dispatcher, the dispatcher wakes the sandbox, creates an OpenCode session, runs the agent prompt, accumulates the response text, and records a row in `agentRuns` with `trigger: "cron"`.

**But the agent's output goes nowhere the user can see it as a conversation.** Only the first 200 characters of the response land in `agentRuns.summary` (visible in the Activity feed on `/home`). The full response vanishes. Users naturally expect scheduled jobs to DELIVER their output to the channels where they already talk to the agent — Slack, Telegram (future), email (future).

Concrete example: "Every weekday at 9am, post the daily standup reminder in #engineering." Currently impossible because the cron's output doesn't reach `#engineering`.

This plan closes the gap.

---

## Decision: Approach B+ (per-cron destination, sourced from agent's existing integrations, platform-agnostic)

Three approaches were considered in the brainstorm preceding this plan:

| Approach | Description | Verdict |
|---|---|---|
| **A** — Explicit destination (manual entry) | User types a channel ID when creating the cron | Rejected: fragile (typos, stale IDs), not extensible |
| **B** — Inherit from agent (automatic) | Post to all of the agent's channel bindings automatically | Rejected alone: no per-cron flexibility, breaks for agents with multiple bindings |
| **B+** — Hybrid (per-cron dropdown) | Each cron has a destination field; options are sourced from the agent's existing `agentIntegrations` rows | **CHOSEN** |
| **C** — LLM tool use (`send_slack_message`) | Agent has a tool and decides dynamically via the LLM | Deferred: no tool infrastructure yet; non-deterministic; harder to debug |

### Why Approach B+

1. **Per-cron flexibility.** Different crons on the same agent can deliver to different channels. "Daily standup → #engineering, weekly sales summary → #sales."
2. **No manual channel ID entry.** The dropdown pulls from integrations the user has already set up via the Slack pick page. Clean UX, no typos.
3. **Platform-agnostic by construction.** When Telegram is added, new rows in `agentIntegrations` for Telegram will naturally appear in the same dropdown with zero schema changes to `agentCrons`. Same for email, WhatsApp, Discord, etc.
4. **Deterministic.** No LLM guessing where to post. The dispatcher posts exactly where the user specified.
5. **Defers Approach C.** Agent-tool-based delivery is a future phase that doesn't need to block this one.

---

## Schema changes (additive, no migration needed)

### `convex/schema.ts`

Two new optional fields on `agentCrons`:

```ts
agentCrons: defineTable({
  agentId: v.id("agents"),
  schedule: v.string(),
  prompt: v.string(),
  enabled: v.boolean(),
  timezone: v.string(),
  lastRunAt: v.optional(v.number()),
  nextRunAt: v.optional(v.number()),

  // ── NEW: cron output delivery ────────────────────────────
  //
  // `deliverToPlatform` — a Channel key matching the agent's
  // integrations: "slack", "telegram", "email", "whatsapp", etc.
  // Free-form string (NOT v.union) so adding a new platform
  // doesn't require a schema migration. Matches the
  // `platform` field on agentIntegrations.
  //
  // `deliverToBinding` — platform-specific destination using
  // the same prefix encoding as agentIntegrations.channelBinding:
  //
  //   chan:C0789       — specific Slack channel
  //   chan:-100123     — specific Telegram chat (future)
  //
  // Workspace-wide bindings (team:T...) are NOT valid cron
  // destinations — the dispatcher needs a specific channel to
  // post to. Validated at create/update time.
  //
  // Both absent = the cron runs but its output only lands in
  // the Activity feed (no external delivery). Useful for
  // log-only schedules and agents without bound channels yet.
  deliverToPlatform: v.optional(v.string()),
  deliverToBinding: v.optional(v.string()),
})
```

---

## Convex mutation changes

### `convex/agentCrons.ts`

- **`create`** — accept `deliverToPlatform` + `deliverToBinding` as optional args; pass through to the insert
- **`update`** — accept both in the patch args; allow clearing by passing `null`

No validation in Convex beyond Convex's built-in type checks. Validation happens at the API-route layer (where we have access to the agent's integrations to cross-check).

---

## API route changes

### `app/api/agents/[id]/crons/route.ts` (POST handler)

Accept `deliverToPlatform` + `deliverToBinding` in the request body.

**Validation rules:**
- If one is set, both must be set
- `deliverToBinding` must start with `chan:` (workspace-wide `team:` bindings rejected with a clear error)
- Verify that an `agentIntegrations` row exists for this agent with matching platform + channelBinding (defense against stale references — the UI should only show valid options anyway, but server-side validation is the trust boundary)

### `app/api/agents/[id]/crons/[cronId]/route.ts` (PATCH handler)

Same validation rules for updates.

---

## UI changes

### `components/agent-management/agent-management-schedule.tsx`

#### `AddCronForm` — add a "Destination" dropdown

Placement: between the Timezone field and the "What should the agent do?" textarea.

```tsx
<div className="flex flex-col gap-1.5">
  <Label className="text-xs">Destination</Label>
  <Select value={destination} onValueChange={setDestination}>
    <SelectTrigger>...</SelectTrigger>
    <SelectContent>
      {/* "Activity feed only" option — always available */}
      <SelectItem value="">Activity feed only</SelectItem>
      {/* One item per valid agent integration */}
      {validIntegrations.map((i) => (
        <SelectItem key={i.id} value={`${i.platform}:${i.channelBinding}`}>
          {formatPlatform(i.platform)} — {formatBinding(i.channelBinding)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

**Dropdown sourcing:**

```ts
const { data: integrations } = useQuery(
  api.integrations.list,
  { agentId: agentId as Id<"agents"> },
);
const validIntegrations = (integrations ?? []).filter(
  (i) => i.channelBinding?.startsWith("chan:"),
);
```

**Empty state** (no valid destinations — agent has only workspace-wide bindings or no integrations):

Show a help message below the Destination field:

> This agent has no specific channels bound. [Go to Slack settings](link) to bind one before scheduling delivery, or choose "Activity feed only" to log runs without posting.

The "Create job" button stays enabled (with "Activity feed only" as the default destination) so users can still schedule log-only jobs.

#### `CronRow` display — show destination

Extend the metadata line under the prompt:

```
schedule • timezone • → Slack #C0789 • next: <date>
```

If `deliverToBinding` is absent, show:
```
schedule • timezone • Activity feed only • next: <date>
```

### `lib/types.ts`

Extend the `CronJob` type:

```ts
export type CronJob = {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  timezone: string;
  nextRunAt?: string;
  deliverToPlatform?: string;  // NEW
  deliverToBinding?: string;    // NEW
};
```

---

## Dispatcher changes

### `app/api/cron/tick/route.ts`

#### Change 1 — Idempotency fix (reorder `markRun`)

**Current order:** run prompt → log run → update `nextRunAt`.

**New order:** run prompt → log run → **update `nextRunAt`** → deliver to Slack.

Why: if the Slack delivery crashes AFTER we've updated `nextRunAt`, the cron is still marked as run for this iteration and retries at its next scheduled time. The only cost is a missed post. If we kept the current order and crashed between `post` and `markRun`, the next tick would re-run the cron and **post twice** (or more).

Rule of thumb: **better to miss a post than to double-post.** One-line reorder, big resilience win.

#### Change 2 — Add Slack delivery path

After `markRun` (which now runs BEFORE delivery), if `cron.deliverToPlatform` + `cron.deliverToBinding` are set and the run status is `"completed"`:

```ts
// Import deferred so non-delivering crons don't pay the cost of
// initializing the Chat SDK bot singleton on every tick.
if (
  cron.deliverToPlatform === "slack" &&
  cron.deliverToBinding?.startsWith("chan:") &&
  text.trim().length > 0 &&
  status === "completed"
) {
  try {
    const { bot, ensureBotInitialized, getSlackAdapter } = await import(
      "@/lib/chat/bot"
    );
    await ensureBotInitialized();

    const channelId = cron.deliverToBinding.slice("chan:".length);

    // Multi-workspace token scoping.
    //
    // In multi-workspace mode, the Slack adapter uses AsyncLocalStorage
    // to know which team's bot token to use. Webhook handlers set up
    // that context automatically (via handleWebhook). The cron
    // dispatcher has NO webhook context, so we need to resolve the
    // installation explicitly and wrap the post call in
    // `slack.withBotToken(token, () => ...)`.
    //
    // To look up the installation, we query agentIntegrations for
    // the binding to find the owning team, then fetch that team's
    // stored bot token via slack.getInstallation(teamId).
    //
    // NOTE: This requires storing teamId alongside channelBinding —
    // see "Schema gap to resolve" in §Open Decisions.
    const slack = getSlackAdapter();
    const installation = /* ...fetch via findByBinding + getInstallation... */;

    await slack.withBotToken(installation.botToken, async () => {
      await bot.channel(`slack:${channelId}`).post(text);
    });

    console.log(
      `[cron/tick] Slack delivery succeeded for cron ${cron._id} → ${channelId}`,
    );
  } catch (err) {
    console.error(
      `[cron/tick] Slack delivery failed for cron ${cron._id}:`,
      err,
    );
    // Don't re-throw — the activity feed row was already logged
    // and nextRunAt was already updated. Next tick continues as
    // normal. A delivery failure is logged for debugging but
    // doesn't block other crons in this batch.
  }
}
```

#### Platform extensibility pattern

The branch structure is:

```ts
if (cron.deliverToPlatform === "slack") { ... }
// Future:
// else if (cron.deliverToPlatform === "telegram") { ... }
// else if (cron.deliverToPlatform === "email") { ... }
```

Adding a new platform later is ~15 lines of parallel code in the same location — all the shared infra (Chat SDK bot, markRun reorder, error handling) is already in place.

---

## Files touched — summary

| File | Change | Rough LOC |
|---|---|---|
| `convex/schema.ts` | +2 optional fields on `agentCrons` | +5 |
| `convex/agentCrons.ts` | `create` + `update` accept 2 new fields | +10 |
| `app/api/agents/[id]/crons/route.ts` | POST validates + forwards the fields | +25 |
| `app/api/agents/[id]/crons/[cronId]/route.ts` | PATCH validates + forwards | +20 |
| `components/agent-management/agent-management-schedule.tsx` | Destination dropdown + help message + row display | +75 |
| `app/api/cron/tick/route.ts` | Slack delivery + markRun reorder | +50 |
| `lib/types.ts` | `CronJob` gets 2 optional fields | +3 |

**Total:** 7 files, ~200 LOC of diff.

---

## Effort estimate

**~2 to 2.5 hours** of focused work, assuming no schema/token scoping surprises.

- 15 min — schema + Convex mutations
- 20 min — API route validation
- 45 min — UI: dropdown + integrations query wiring + help message + row display
- 45 min — dispatcher: Slack delivery + multi-workspace token scoping + idempotency reorder
- 15 min — typecheck + build + manual testing
- 10 min — commit + push

---

## Out of scope — explicit list of what this plan does NOT ship

Deferred to v2 or later phases:

- **Channel name display.** Dropdown shows `"Slack — C0AGC1TTMN2"` (raw channel ID), not `"Slack — #engineering"`. Requires caching `conversations.info` results. Not hard but not this pass.
- **Workspace-wide binding destinations.** Agents with only `team:T...` bindings can't be cron destinations. Users must re-bind via the Slack pick page. Alternative future: fetch channel list via Slack API and present all workspace channels in the dropdown.
- **Multiple destinations per cron.** One cron = one destination. Future: array of destinations, or "fan-out" mode.
- **DM delivery.** Posting to a user's DM (`im:` binding) instead of a channel. Requires schema and dispatcher extension.
- **Long-message chunking.** Slack has a ~3000 char limit per block. Long agent responses may truncate. Needs manual chunking logic for responses > block limit.
- **Rich delivery status tracking.** Currently runs are logged as `"completed"` or `"failed"`. Should add `"delivered"` / `"delivery_failed"` as distinct states so the Activity feed can show delivery status separately from run status.
- **Template variables in prompts.** E.g., `"Good morning! Today is {{date}}, yesterday's PR count was {{prs}}"`. Interesting feature but out of scope.
- **Approach C (LLM tool use).** Agent has a `send_slack_message` tool and decides dynamically. Waits for tool infrastructure.
- **Rate limiting per destination.** If the user schedules 20 crons to the same channel, Slack's rate limit would bite. Low priority at Dispatch's current scale.
- **Delivery confirmation in the UI.** Showing "Last delivered at X" on each cron row. Polish.

---

## Open decisions still needed from user

### 1. Workspace-wide binding handling

The user's ONE current `agentIntegrations` row is `team:T0AE0GT2UCF` (workspace-wide). This row is NOT a valid cron destination under Approach B+. Options:

- **(a) Hide from dropdown with help message** (my default). User must re-bind via Slack pick page to get channel-specific bindings.
- **(b) Fall back to manual channel ID text input** for agents with workspace-wide only.
- **(c) Fetch workspace's full channel list via Slack API** and present all channels the bot has access to.

My recommendation: **(a)** for MVP, add **(c)** in v2 if users complain. Not **(b)** because it reintroduces the manual-entry fragility we were avoiding.

### 2. Branch choice

- **Bundle on `feat/chat-sdk`** (default) — 11 commits on there already, it's not merged yet, this feature is logically adjacent (Chat SDK outbound posting). One bigger PR.
- **New `feat/cron-delivery` branch based on `feat/chat-sdk`** — smaller, more focused PR. Requires the chat-sdk PR to merge first OR handling the branch dependency.

My recommendation: **bundle on `feat/chat-sdk`**.

### 3. Schema gap to resolve: teamId on channel bindings

When an agent is bound to a specific Slack channel (`chan:C0789`), we know the channel ID but **we don't currently store which Slack team owns that channel.** The webhook path doesn't need it (incoming events carry `team_id`), but cron-initiated **outbound** posts DO need it — Chat SDK's multi-workspace adapter needs the team to look up the right bot token.

Two ways to solve:

- **(a) Add a `teamId` column to `agentIntegrations`.** Schema migration (but backward-compatible — existing rows get null, new rows populate it). The slack-pick flow already has `teamId` in the URL; we just need to stop throwing it away. **~5 lines in `bindAgent` mutation.**
- **(b) Encode teamId in the binding string.** Change `chan:C0789` to `chan:T0AE:C0789`. Breaks existing rows if not migrated carefully. Rejected.

**Decision: (a).** Add `teamId` field to `agentIntegrations` schema, populate in `bindAgent`. Existing workspace-wide rows get `teamId` from parsing `team:T0AE`. New channel-specific rows get it from the already-present query param. This unblocks cron→Slack delivery AND improves the data model generally (we should have been storing teamId all along).

---

## Reference points

- **Current cron dispatcher:** `app/api/cron/tick/route.ts`
- **Current schedule UI:** `components/agent-management/agent-management-schedule.tsx`
- **Slack adapter source:** `node_modules/@chat-adapter/slack/dist/index.js` (especially `stream()` at ~2735, `withBotToken` at ~830, `getInstallation` at ~210)
- **Chat SDK `Channel.post()` API:** `node_modules/chat/docs/api/channel.mdx`
- **Existing integrations query:** `convex/integrations.ts` → `api.integrations.list`
- **Chat SDK bot singleton:** `lib/chat/bot.ts` (already exports `bot`, `ensureBotInitialized`, `getSlackAdapter`)

---

## Validation checklist (for when shipping)

- [ ] Schema migration applies cleanly (`npx convex dev` succeeds)
- [ ] Existing crons without delivery fields continue to work (backward compatible)
- [ ] Creating a new cron with a valid channel destination succeeds
- [ ] Creating a cron with an invalid binding (workspace-wide) is rejected with a clear error
- [ ] The dispatcher's `markRun` runs BEFORE the Slack post (idempotency)
- [ ] A crashed delivery doesn't re-fire the cron on the next tick
- [ ] Slack post succeeds in multi-workspace mode (token scoping works)
- [ ] Dropdown populates correctly from `api.integrations.list`
- [ ] Workspace-wide-only agents see the help message and can still create log-only crons
- [ ] Typecheck clean, build clean
- [ ] Manual test: create a cron with `*/2 * * * *` schedule, wait, confirm bot posts in the selected channel
