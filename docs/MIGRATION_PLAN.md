# Dispatch V2 Migration Plan

## What V2 Is

Single Next.js app on Vercel for deploying vertical AI agents. Each agent runs inside a Daytona sandbox with a persistent S3-backed volume through a Dispatch runtime adapter. `OpenCodeRuntimeAdapter` is the first implementation; `PiRuntimeAdapter` should remain viable later. Convex is the control plane for app state, workflows, billing metadata, integrations, dashboards, and agent packs. Chat SDK is the multi-channel bot shell for Slack, Telegram, Teams, GitHub, Linear, and similar surfaces. No VMs, no gateway, no provisioner, no Terraform. See `V2_ARCHITECTURE.md` for full design.

---

## What to Bring From V1

### 1. Auth (copy + adapt)

**Source:** `packages/server-lib/src/auth/`

| File | What to bring | Changes needed |
|------|--------------|----------------|
| `better-auth.ts` | Better Auth config, Google OAuth, database hooks, session config | Swap Supabase adapter assumptions for Convex-compatible auth/session storage |
| `auth.ts` | `getAuthUser(req)`, `getAuthUserFromToken(token)`, user lookup | Minimal — adapt lookup helpers to Convex user records |
| `permissions.ts` | `getToolPermission()`, scope merging, prompt rendering | Adapt for OpenCode permission format (allow/ask/deny per tool in AGENTS.md) |
| `rateLimit.ts` | Sliding window rate limiter | Copy as-is, works standalone |

**Effort:** 1-2 days. Auth is the most portable piece.

### 2. Billing & Credits (copy + adapt)

**Source:** `packages/server-lib/src/billing/`

| File | What to bring | Changes needed |
|------|--------------|----------------|
| `credits.ts` | Model pricing table, atomic credit operations, tier configs, trial bonus logic | Update model pricing if needed. Credit deduction changes from LLM proxy events to OpenCode `session.completed` usage data. |
| `licenses.ts` | License entitlement logic | Simplify — Daytona doesn't have fixed VM slots. Might become "max agents per tier" check. |
| `public-billing.ts` | Stripe price ID config, billing cycle helpers | Copy as-is |

**Stripe webhook handlers** (from `api/webhooks/stripe.ts`):
- `customer.subscription.created/updated/deleted` — license + credit sync
- `invoice.payment_succeeded/failed` — credit top-ups
- These survive almost unchanged.

**Key difference:** V1 deducts credits via the LLM proxy (`api/llm/*`). V2 deducts credits from OpenCode's `session.completed` event which includes token usage. The pricing table and atomic operations stay the same.

**Effort:** 2-3 days. Mostly mechanical.

### 3. Types (cherry-pick)

**Source:** `packages/types/src/`

| File | Keep? | Notes |
|------|-------|-------|
| `user.ts` | Yes | `User`, `SubscriptionTier`, `OnboardingData` |
| `billing.ts` | Yes | `TierConfig`, `SelfServePlanConfig` |
| `ai-models.ts` | Yes | 100+ model definitions, provider types. Huge value. |
| `automation.ts` | Partial | Keep `ActionPermission`, `ActionScopes`. Drop workflow/run types (rebuild simpler). |
| `integrations.ts` | Yes | `Integration`, `IntegrationConfig`, `IntegrationStatus` |
| `agent.ts` | Adapt | Keep the agent product language, but drop VM-specific types (`RunnerState`, `RunnerHealth`, SSH fields). Add Daytona-specific types (`sandboxId`, `volumeId`, `sandboxState`). |
| `events.ts` | Adapt | Map to OpenCode's event types (`session.updated`, `message.part.updated`, etc.) instead of custom `text_delta`, `tool_start`. |
| `api.ts` | Partial | Keep `ContentPart` types. Drop WebSocket-specific types (V2 uses SSE). |
| `skills.ts` | Drop | OpenCode has native agent/tool definitions |
| `cron.ts` | Yes | Cron schedule types survive |
| `tasks.ts` | Partial | Simplify |
| `errors.ts` | Yes | Custom error types |

**Effort:** 1 day. Copy files, delete VM-specific stuff, add Daytona types.

### 4. UI Components (cherry-pick)

**Source:** `apps/web/src/components/ui/`

**Bring over (custom):**
- `chatgpt-prompt-input.tsx` — Rich prompt box with model picker, attachments, voice
- `voice-input.tsx` — Audio recording with WebAudio API
- `pricing-table.tsx` — Billing page pricing grid
- `tool-card.tsx` — Integration/tool display card
- `status-dot.tsx` — Agent status indicator (adapt states for Daytona)
- `loading-dots.tsx` — Loading animation
- `shimmering-text.tsx` — Skeleton shimmer
- `social-button.tsx` — OAuth buttons

**Reinstall fresh via shadcn CLI:**
All standard shadcn components (accordion, dialog, dropdown-menu, etc.) — don't copy, just `npx shadcn@latest init` + `add` what you need.

**Effort:** 1 day for custom components. shadcn setup is minutes.

### 5. Feature-Level UI (selective)

**Source:** `apps/web/src/features/`

| Feature | Reuse | Notes |
|---------|-------|-------|
| `inbox/` (chat) | 40% | Event log + deriver pattern survives conceptually, but events change to OpenCode format. Chat panel UI components (message bubbles, tool cards, thinking indicators) can be adapted. WebSocket client → SSE client. |
| `agents/` | 30% | Dashboard layout, card grid, creation wizard. But all VM-specific logic (provisioning status, SSH health, VNC, warm pool) gets deleted. |
| `billing/` | 80% | Pricing page, credit usage, subscription management — almost unchanged. |
| `settings/` | 70% | User settings, API key management. |
| `marketplace/` | 60% | Browse/purchase/list agent packs and vertical AI agents. Schema simplifies but UI structure stays. |
| `onboarding/` | 50% | Wizard flow. Steps change (no VM provisioning step). |
| `admin/` | 40% | Admin dashboard. Drop VM health monitoring, keep user/billing admin. |
| `files/` | 60% | File browser. Changes from SSH-based to Daytona `fs.listDir()`/`fs.readFile()`. |
| `automations/` | 30% | Workflow builder. Rethink on top of OpenCode sessions. |

### 6. Control-Plane Schema

**V1:** 69 migrations, ~25+ tables
**V2:** Convex tables/functions (see `V2_ARCHITECTURE.md`)

**Data migration needed for:**
- `users` → `users` (1:1, minor field changes)
- legacy agent records → `agents` runtime records (drop VM fields, add Daytona fields)
- `user_credits` → user credit balance + ledger in Convex
- `credit_transactions` → credit ledger records in Convex
- legacy agent integrations → agent integration documents (simplified)
- `automations` → agent cron documents (simplify dramatically — OpenCode handles the execution)
- `better_auth_*` → `better_auth_*` (unchanged)

**What dies:** `activity_logs` (partitioned), `agent_events`, `warm_pool`, `vnc_sessions`, `chat_approvals`, `tasks`, `marketplace_*` (rebuild simpler), `leads`, `referral_program`

**Effort:** 1 day for Convex schema/functions. User data migration script: 1-2 days.

### 7. Server Lib Utilities

**Source:** `packages/server-lib/src/core/`

| Utility | Keep? |
|---------|-------|
| `db.ts` (`getSupabase()`) | Adapt — replace with Convex client/server helpers |
| `stripe-factory.ts` (`getStripe()`) | Yes |
| `api-error.ts` (`withHandler()`) | Adapt for Next.js App Router (try/catch in route handlers) |
| `security.ts` (CORS, cron auth) | Simplify — Next.js handles CORS differently |
| `sse.ts` | Drop — use Web Streams API natively in Next.js route handlers |
| `env.ts` | Yes |
| `logger.ts` | Yes |

**Source:** `packages/server-lib/src/chat/`

| Utility | Keep? |
|---------|-------|
| `system-prompt.ts` | Drop — OpenCode reads AGENTS.md natively |
| `prompt-builder.ts` | Drop — OpenCode handles message formatting |
| `channel-prompts.ts` | Partial — keep Telegram/Slack prompt variants as context injected via OpenCode sessions |
| `chat-history.ts` | Drop — OpenCode stores in SQLite on volume |

**Source:** `packages/server-lib/src/vm/`
- **Everything here dies.** `sshExec`, `connectToVM`, `vm-commands`, `vm-paths` — all replaced by Daytona SDK.

---

## What's New to Build

### 1. Docker Image (`ghcr.io/dispatch/agent-sandbox`)

```
Ubuntu 22.04 base
├── OpenCode CLI (installed via curl)
├── Our MCP server (Node.js, ~500 lines)
├── Standard tools (git, jq, ripgrep, python3, node)
└── entrypoint.sh (starts OpenCode serve + MCP server)
```

**Effort:** 1-2 days

### 2. MCP Server (custom tools)

```
plugins/dispatch-mcp/
├── src/
│   ├── index.ts          # MCP server setup + stdio transport
│   ├── tools/
│   │   ├── browser.ts    # Browserbase/Stagehand web browsing
│   │   ├── email.ts      # Gmail API integration
│   │   ├── calendar.ts   # Google Calendar
│   │   ├── message.ts    # Chat SDK-backed channel replies/sends
│   │   ├── computer.ts   # Spawn additional Daytona sandboxes
│   │   └── memory.ts     # Read/write agent memories
│   └── lib/
│       └── daytona.ts    # Daytona SDK wrapper
└── package.json
```

Each tool is ~50-100 lines. Total ~500-800 lines.

**Effort:** 1-2 weeks (most time spent on Browserbase + Gmail OAuth setup)

### 3. OpenCode SDK Integration Layer

```typescript
// lib/agents/ensure-running.ts  — Wake sandbox + connect to OpenCode
// lib/agents/create.ts          — Create volume + sandbox + write config
// lib/agents/config.ts          — Push config changes to volume
// lib/agents/delete.ts          — Destroy sandbox + volume
```

**Effort:** 2-3 days. V2 doc has working code.

### 3b. Runtime Adapter Layer

Dispatch should define a harness-agnostic runtime interface so the product layer does not hard-code OpenCode semantics everywhere.

Initial adapters:
- `OpenCodeRuntimeAdapter` — production default
- `PiRuntimeAdapter` — experimental alternate harness

This boundary should own:
- session creation
- prompt/run execution
- event streaming normalization
- usage extraction
- cancellation
- runtime-specific config translation

### 4. API Routes (Next.js App Router)

```
app/api/
├── agents/
│   ├── route.ts                    # List + create agents
│   └── [id]/
│       ├── route.ts                # Get + update + delete agent
│       ├── chat/
│       │   ├── route.ts            # Send message → OpenCode → SSE stream
│       │   └── cancel/route.ts     # Cancel current run
│       ├── sessions/
│       │   ├── route.ts            # List sessions
│       │   └── [sessionId]/route.ts # Get messages, delete session
│       ├── crons/route.ts          # CRUD crons
│       ├── files/route.ts          # List/read/upload files
│       ├── memory/route.ts         # CRUD memories
│       └── integrations/route.ts   # CRUD integrations
├── cron/
│   └── tick/route.ts               # Dispatch scheduled agent runs
├── auth/
│   └── [...betterauth]/route.ts    # Better Auth catch-all
├── webhooks/
│   ├── stripe/route.ts             # Stripe events
│   ├── telegram/route.ts           # Chat SDK Telegram adapter entrypoint
│   ├── slack/route.ts              # Chat SDK Slack adapter entrypoint
│   ├── teams/route.ts              # Chat SDK Teams adapter entrypoint
│   ├── github/route.ts             # Chat SDK GitHub adapter entrypoint
│   └── linear/route.ts             # Chat SDK Linear adapter entrypoint
└── billing/
    ├── subscribe/route.ts
    ├── portal/route.ts
    └── credits/route.ts
```

~25 route files vs V1's 198. Most are thin: auth → Daytona SDK → OpenCode SDK → response.

**Effort:** 2-3 weeks total across all phases.

### 5. Frontend Chat (SSE instead of WebSocket)

The event log + deriver pattern from the current refactor survives, but the transport and event types change:

| V1 | V2 |
|----|-----|
| WebSocket (`ChatWsClient`) | `fetch()` + SSE ReadableStream |
| Custom gateway events (`text_delta`, `assistant_start`) | OpenCode events (`session.updated`, `message.part.updated`) |
| `ChatEventLog` (append-only, seq dedup) | Same pattern, different event shapes |
| `deriveState()` pure function | Same pattern, adapted for OpenCode events |
| `useSyncExternalStore` | Same |

**Effort:** 3-5 days. Conceptually identical, mechanically different.

---

## What Gets Deleted (the satisfying part)

| Component | Lines | Replacement |
|-----------|-------|-------------|
| `services/gateway/` | ~4,300 | Single API route + SSE |
| `services/provisioner/` | ~11,800 | `daytona.create()` |
| `infrastructure/terraform/` | ~500 | Nothing (Daytona is managed) |
| `packages/server-lib/src/vm/` | ~500 | Daytona SDK |
| `database/migrations/` (69 files) | N/A | Convex schema + functions |
| `api/` (198 route files) | ~15,000 | ~25 route files |
| `services/api/` (local dev server) | ~1,000 | `next dev` |
| LLM proxy (`api/llm/*`) | ~2,000 | OpenCode handles LLM calls natively |
| Agent packs (67 files) | ~3,000 | AGENTS.md + .opencode/config.json per agent pack |

**Total deleted: ~38,000+ lines.**
**Total V2 codebase estimate: 3,000-5,000 lines of our code** + Next.js + OpenCode + Daytona.

---

## Risk Checklist

Before committing to full migration, validate these in Phase 1:

- [ ] **SQLite on Daytona volume** — Does OpenCode's SQLite work reliably on S3-backed FUSE? Test with 100+ messages in a session, rapid reads/writes, sandbox restart mid-write.
- [ ] **Convex event model** — Define which runtime events get mirrored into Convex for live dashboards, audit trails, approvals, and usage views without over-syncing raw agent history.
- [ ] **Cold start time** — Measure: sandbox wake + OpenCode server boot + MCP server start. Target: <3s total. If >5s, need warm pool equivalent.
- [ ] **OpenCode event format** — Map every OpenCode SSE event type to our UI state. Verify: text streaming, tool calls, thinking/reasoning, errors, cancellation, approval flows.
- [ ] **OpenCode server mode stability** — Run load test: 10 concurrent chat sessions, 50 tool calls, session compaction. Watch for crashes, memory leaks, hung sessions.
- [ ] **Daytona sandbox-to-sandbox** — Can an MCP tool running inside a sandbox create another sandbox via Daytona API? (Required for "computer" tool.)
- [ ] **Credit tracking from OpenCode events** — Verify `session.completed` includes accurate token usage (input + output) for credit deduction.
- [ ] **OpenCode MCP integration** — Verify custom MCP tools appear in agent's tool list, execute correctly, return results to the conversation.

---

## Phased Timeline

### Phase 1: Core (Weeks 1-3)
- Next.js app scaffold (App Router, Tailwind, shadcn)
- Convex schema/functions (agents, runs, crons, integrations, usage, approvals, agent packs)
- Better Auth setup (copy from V1)
- Agent CRUD → Daytona sandbox + volume + OpenCode config
- Chat endpoint → OpenCode SDK prompt + SSE stream
- Basic chat UI (adapt event log + deriver)
- **Milestone: Create an agent, chat with it, messages persist across sandbox restarts**

### Phase 2: Tools + Billing (Weeks 3-5)
- MCP server (browser, email, calendar, computer, memory)
- Credit tracking from OpenCode usage events
- Stripe subscription integration (copy from V1)
- Session management UI (list, switch, delete)
- Model picker (copy from V1, connects to OpenCode config)
- **Milestone: Agent browses web, sends emails, costs are tracked**

### Phase 3: Messaging + Crons (Weeks 5-7)
- Chat SDK adapter wiring (Telegram, Slack first)
- Optional expansion adapters (Teams, GitHub, Linear)
- Persistent sessions for platform threads
- Cron system (Convex-backed schedules + Vercel cron + OpenCode prompt)
- **Milestone: An agent works on Telegram + Slack and runs scheduled tasks**

### Phase 4: Polish + Migrate (Weeks 7-10)
- Dashboard UI (agent list, status, usage)
- Settings, billing pages (copy from V1)
- File browser (Daytona fs API)
- Agent packs / marketplace (simplified)
- User data migration script (V1 → V2)
- Beta testing with existing users
- **Milestone: Feature parity, ready for user migration**

---

## Open Decisions

1. **Repo setup** — Fresh Next.js with `create-next-app` or use `next-forge` (monorepo starter with auth, billing, email pre-wired)?
2. **Chat SDK hosting model** — Vercel route handlers only vs dedicated lightweight service for adapters that need more control over connection lifecycle or retries?
3. **Agent memories** — Volume markdown files (OpenCode reads natively) vs Convex-backed searchable metadata/editor state? Can do both.
4. **Marketing site** — Keep Astro on V1 repo, or rebuild in Next.js V2 (simpler single-app deploy)?
5. **OpenCode fork** — If MCP integration has issues or SQLite-on-FUSE is unreliable, we may need to fork OpenCode and patch it. Budget 1 week for this contingency.
