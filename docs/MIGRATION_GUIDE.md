# Dispatch V1 → V2 Migration Guide

What to carry, what to drop, and what to rebuild so Dispatch keeps its core product identity: vertical AI agents powered by reusable agent packs.

---

## TL;DR

| Area | V1 | V2 | Action |
|------|----|----|--------|
| Frontend framework | Vite SPA + Astro | Next.js App Router | Rewrite |
| Chat transport | WebSocket (Railway gateway) | SSE (Vercel serverless) | Rewrite |
| Agent runtime | VM-based runtime on EC2/Hetzner VMs | OpenCode on Daytona sandboxes | Replace |
| Provisioning | Lambda + Terraform | Daytona SDK | Replace |
| Session storage | Volatile (VM memory) | SQLite on Daytona volume | Free (OpenCode native) |
| Auth | Better Auth (cookie sessions) | Better Auth (same) | Copy |
| Billing/Stripe | Custom credit system | Same pattern, simpler | Copy + simplify |
| Control plane | Supabase-heavy control plane | Convex control plane | Rebuild around Convex |
| API routes | 198 serverless functions | ~25 Next.js route handlers | Rewrite (much less code) |
| External tools | SSH + VM-native | MCP server in sandbox | Rewrite |
| Messaging layer | Gateway background bridges | Chat SDK adapters → Daytona/OpenCode | Rewrite |

---

## What to COPY from V1

### 1. Auth Logic
**Source:** `packages/server-lib/src/auth/better-auth.ts`

Keep the Better Auth config almost verbatim:
- Google social provider
- Cookie session (7-day expiry, daily refresh)
- `databaseHooks.user.create.after` for post-signup side effects
- `getAuthUser(req)` pattern for validating sessions

**Changes:**
- Swap Supabase adapter for Convex-compatible auth storage/session handling
- Move from standalone serverless function to Next.js route handler
- Password reset flow carries over

### 2. Billing/Stripe Integration
**Source:** `packages/server-lib/src/billing/`

Carry over:
- Stripe subscription tiers + plan configs
- Credit balance checking + deduction logic
- Stripe webhook handler (invoice.paid, subscription events)
- Credit transaction logging

**Changes:**
- Replace LLM proxy credit tracking with OpenCode event-based tracking
- Simplify — no need for per-provider proxy routes (OpenCode handles providers)

### 3. UI Components (cherry-pick)
**Source:** `apps/web/src/`

Worth extracting and adapting:
- `components/ui/` — Radix + Tailwind primitives (Button, Dialog, Input, etc.)
- `components/ui/chatgpt-prompt-input.tsx` — model picker + composer
- `features/inbox/lib/chat-deriver.ts` — event → UI state derivation (adapt for OpenCode events)
- `features/inbox/lib/chat-event-log.ts` — append-only event store
- `features/agents/` — agent CRUD UI patterns
- `features/settings/` — account/team settings
- `features/billing/` — subscription management UI
- `store/` — Zustand patterns for auth, theme, sidebar state
- `lib/ai-models.ts` — model definitions + provider logos

**NOT worth carrying:**
- `features/inbox/lib/chat-ws-client.ts` — WebSocket client (replaced by SSE fetch)
- `services/gateway/` — entire gateway service
- `features/marketplace/` — if agent-pack marketplace is not in V2 MVP

### 4. Data Layer Patterns
**Source:** `packages/server-lib/src/core/db.ts`

- Client singleton / server-entry patterns still matter, but rework them for Convex queries, mutations, and actions
- Encrypted field helpers (`packages/server-lib/src/core/models.ts`) are still useful for integration secrets
- Move authorization rules out of Postgres RLS and into Convex access patterns + server-side checks

### 5. Integration Configs
**Source:** `packages/server-lib/src/integrations/`

The Telegram/Slack/WhatsApp token management and webhook verification logic is reusable — but the execution path should move behind Chat SDK adapters so Dispatch gets one normalized thread/message model across channels.

### 6. Internal Tooling
- Slack internal notifications (`packages/server-lib/src/core/slack-internal.ts`)
- Rate limiting (`packages/server-lib/src/core/rateLimit.ts`)
- CORS helpers (`packages/server-lib/src/core/security.ts`)

---

## What to DROP (V2 doesn't need these)

### Entire Services
- `services/gateway/` — Railway WebSocket bridge (OpenCode SSE replaces this)
- `services/provisioner/` — Lambda VM provisioner (Daytona SDK replaces this)
- `services/api/` — local dev proxy (Next.js dev server replaces this)

### Infrastructure
- `infrastructure/terraform/` — VPC, security groups, IAM, S3 (Daytona manages infra)
- EC2/Hetzner VM management scripts
- Cloudflare tunnel scripts
- SSH key management

### Server-Lib Modules
- `packages/server-lib/src/vm/` — VM SSH operations, health checks, fleet management
- `packages/server-lib/src/chat/` — chat-persistence, chat-history (OpenCode SQLite replaces)
- `packages/server-lib/src/platform/` — warm pool, fleet rollout

### API Routes (~150 of 198 go away)
- `api/llm/*` — LLM proxy routes (OpenCode handles provider calls)
- `api/agents/*/vm-*` — VM management endpoints
- `api/agents/*/chat` — WebSocket-based chat (replaced by SSE)
- `api/cron/sync-configs` — SSH-based config push (replaced by volume writes)
- `api/cron/health-check` — VM health monitoring (Daytona handles this)
- `api/cron/warm-pool` — pre-provisioned VM pool (Daytona starts in <100ms)
- `api/vnc/*` — NoVNC proxy (use Daytona preview URLs)

### Database Tables (~23 of ~30 drop)
These are no longer needed:
- legacy agent records → agent records with fewer infrastructure columns
- `chat_messages` → OpenCode SQLite
- `activity_logs` → OpenCode events
- `telegram_bot_pool` → simplified integration model
- `vm_*` tables → no VMs
- `warm_pool` → no warm pool
- Most `licenses`, `tasks`, `activities` tables

### Frontend Features
- `features/inbox/lib/chat-ws-client.ts` — WebSocket client
- `features/inbox/lib/chat-event-normalizer.ts` — gateway event normalization
- NoVNC viewer components
- VM status indicators

---

## What to BUILD from scratch

### 1. Next.js App Router Scaffold
```
dispatch-v2/
├── app/
│   ├── layout.tsx              # Root layout + providers
│   ├── page.tsx                # Landing/marketing
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Sidebar + nav
│   │   ├── agents/
│   │   │   ├── page.tsx        # Agent list
│   │   │   ├── new/page.tsx    # Create agent
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # Agent chat (default)
│   │   │       ├── settings/page.tsx
│   │   │       ├── files/page.tsx
│   │   │       ├── crons/page.tsx
│   │   │       └── integrations/page.tsx
│   │   ├── settings/page.tsx
│   │   └── billing/page.tsx
│   └── api/
│       ├── auth/[...betterauth]/route.ts
│       ├── agents/
│       │   ├── route.ts                    # LIST, CREATE
│       │   └── [id]/
│       │       ├── route.ts                # GET, PATCH, DELETE
│       │       ├── chat/route.ts           # POST → SSE stream
│       │       ├── chat/cancel/route.ts
│       │       ├── sessions/route.ts
│       │       ├── sessions/[sid]/route.ts
│       │       ├── files/route.ts
│       │       ├── crons/route.ts
│       │       ├── integrations/route.ts
│       │       └── memory/route.ts
│       ├── cron/tick/route.ts
│       └── webhooks/
│           ├── stripe/route.ts
│           ├── telegram/route.ts
│           └── slack/route.ts
├── lib/
│   ├── auth.ts                 # Better Auth server config
│   ├── auth-client.ts          # Better Auth client
│   ├── convex.ts               # Convex client helpers
│   ├── daytona.ts              # Daytona SDK singleton
│   ├── opencode.ts             # OpenCode client factory
│   ├── agents/
│   │   ├── create.ts           # Agent creation (sandbox + volume)
│   │   ├── ensure-running.ts   # Wake sandbox if stopped
│   │   └── config-sync.ts      # Push config to volume
│   ├── billing/
│   │   ├── credits.ts          # Balance check + deduction
│   │   └── stripe.ts           # Stripe webhook handlers
│   └── integrations/
│       ├── telegram.ts
│       └── slack.ts
├── components/                  # shadcn/ui + custom
├── hooks/
│   └── use-agent-chat.ts       # SSE-based chat hook
└── plugins/
    └── dispatch-mcp/          # MCP server for custom tools
        ├── src/index.ts
        ├── src/tools/
        │   ├── browser.ts
        │   ├── email.ts
        │   ├── calendar.ts
        │   ├── message.ts
        │   ├── computer.ts
        │   └── memory.ts
        └── Dockerfile
```

### 2. Daytona Integration Layer
- `lib/daytona.ts` — singleton client
- `lib/agents/create.ts` — volume + sandbox + OpenCode bootstrap
- `lib/agents/ensure-running.ts` — wake sandbox, wait for health
- Docker image (`plugins/dispatch-mcp/Dockerfile`)

### 3. OpenCode SSE Chat
- `app/api/agents/[id]/chat/route.ts` — auth → credits → ensure sandbox → opencode.prompt() → stream SSE
- `hooks/use-agent-chat.ts` — client-side SSE consumer + event log
- Adapt `chat-deriver.ts` for OpenCode event format (different from gateway events)

### 4. MCP Server (Custom Tools)
- Browser (Browserbase + Stagehand)
- Email (Gmail API or Composio)
- Calendar (Google Calendar)
- Message (Telegram/Slack send)
- Computer (spawn additional Daytona sandboxes)
- Memory (volume-backed or Convex-backed metadata/index)

### 5. Cron Dispatcher
- `app/api/cron/tick/route.ts` — query due crons → wake sandboxes → prompt OpenCode
- Agent cron CRUD UI

### 6. Chat SDK Channel Layer
- Replace custom per-platform bot handling with Chat SDK adapters
- Start with Telegram + Slack, then expand to Teams/GitHub/Linear if useful for specific agent packs
- Keep platform thread bindings in Convex so each agent can maintain persistent context per channel

---

## Effort Estimate

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1: Core** | Next.js scaffold, auth, Convex schema/functions, agent CRUD, Daytona integration, basic chat | 2 weeks | Daytona SDK access, OpenCode server mode |
| **Phase 2: Tools + Billing** | MCP server, credit tracking, Stripe, session management UI | 2 weeks | Browserbase account, Gmail API setup |
| **Phase 3: Messaging + Crons** | Chat SDK adapters, persistent channel sessions, cron system | 1 week | Integration tokens |
| **Phase 4: Polish** | Teams, file browser, memory editor, templates | 1-2 weeks | — |

**Total: 6-7 weeks to feature parity, 2-3 weeks to MVP (core chat + agent CRUD).**

### Key Risks
1. **OpenCode server mode maturity** — needs testing for production reliability
2. **SQLite on Daytona FUSE volumes** — performance unknown, may need benchmarking
3. **Sandbox cold start compounding** — OpenCode + MCP server startup time when sandbox wakes
4. **OpenCode event format** — need to verify SSE events include enough data for our UI (tool calls, thinking, usage)
5. **Daytona SDK TypeScript support** — verify SDK is stable and well-documented

### Quick Wins (can prototype in days)
- Daytona sandbox creation + OpenCode server boot
- SSE streaming from OpenCode → browser
- Basic chat working end-to-end

---

## V1 → V2 User Migration

When V2 is ready, migrate existing users:

1. **User accounts** — export from V1 Supabase, import into Convex/Better Auth storage for V2
2. **Stripe customers** — same Stripe account, just update webhook URLs
3. **Agent configs** — extract from V1 agent records → generate `AGENTS.md` files on Daytona volumes
4. **Chat history** — V1 chat_messages are unreliable anyway (fire-and-forget). Clean break is fine.
5. **Integration tokens** — decrypt from V1, re-encrypt for V2 Convex-backed agent integration records
6. **Cron definitions** — map V1 automation_runs → V2 agent_crons

Run V1 and V2 in parallel during transition. Existing users stay on V1 until individually migrated.
