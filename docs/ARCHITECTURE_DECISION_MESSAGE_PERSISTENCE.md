# Architecture Decision: Convex Message Persistence

**Date:** April 5, 2026  
**Status:** Accepted  
**Authors:** Dispatch Team  
**Spec:** `docs/superpowers/specs/2026-04-05-convex-message-persistence-design.md`

---

## Context

Dispatch is an autonomous AI agent orchestration platform. Agents run inside Daytona sandboxes with harnesses like OpenCode (and eventually OpenHands, Goose, etc.). Users interact with agents via a chat interface.

Until now, messages lived exclusively in the harness's internal storage (OpenCode's SQLite inside the sandbox). This was fine for a single-user, single-tab, interactive chat prototype. It breaks for anything beyond that.

## Problem

Messages stored in sandbox SQLite are:

1. **Ephemeral** — lost when the sandbox restarts, times out, or is deleted
2. **Inaccessible** — can only be read through the harness's API while the sandbox is running
3. **Single-client** — no way for two browser tabs (or Slack + web) to see the same conversation
4. **Non-searchable** — no full-text search across conversations
5. **Not auditable** — no durable record for billing, analytics, or compliance

This blocks every major feature on the roadmap:
- Autonomous agents (crons, webhooks) need durable message trails
- Multi-channel (Slack, Telegram) needs shared conversation state
- Vercel Workflow needs crash-safe message persistence
- Thread management needs a queryable message store

## Decision

Adopt `@convex-dev/agent` (Convex's first-party AI agent library) for message persistence and streaming.

### Why `@convex-dev/agent` over custom tables

We evaluated three approaches:

**1. Custom Convex tables (messages + messageChunks)**
- Build our own message table, chunk buffering, streaming queries
- Full control, but 500+ lines of custom plumbing
- Must handle: ordering, pagination, delta streaming, heartbeats, stream cleanup, optimistic updates
- Ongoing maintenance burden

**2. AI SDK `onFinish` persistence**
- Persist completed messages via AI SDK's `onFinish` callback
- Simple to implement, but messages only saved AFTER stream completes
- No real-time multi-client sync during generation
- Page refresh during stream = lost context

**3. `@convex-dev/agent` with DeltaStreamer** (chosen)
- First-party Convex library, actively maintained (v0.6.1)
- Automatic thread/message management with managed tables
- Delta-based streaming: chunks written to Convex in real-time (~100ms throttle)
- `useUIMessages` hook for reactive client reads over WebSocket
- Built-in: pagination, text smoothing, optimistic updates, stream heartbeats
- Uses `UIMessage` format (AI SDK standard) — compatible with assistant-ui
- `DeltaStreamer` class designed for piping external streams (exactly our OpenCode use case)

The library eliminates all custom streaming persistence code while giving us more features than we'd build ourselves.

### Why Convex action over Next.js API route

The chat endpoint moves from a Next.js API route to a Convex action because:

1. **DeltaStreamer requires `ActionCtx`** — it writes to Convex component tables internally
2. **One fewer hop** — client → Convex action → harness, instead of client → API route → Convex
3. **Auth is provider-agnostic** — Convex validates JWTs from any issuer (WorkOS, Clerk, Auth0). Changing auth providers is a config change, not an architecture change
4. **Durable execution path** — same Convex action pattern works for crons and webhooks later

### Why keep `agentSessions` table

The `@convex-dev/agent` component creates its own `threads` table, but it's generic — indexed by `userId`, not by `agentId`. Our `agentSessions` table provides:

- Fast per-agent queries via `by_agent` index (O(log n) regardless of total thread count)
- Room for app-specific metadata
- Custom indexes we can add later (by_team, by_status) without touching the component
- The component handles heavy data (messages, deltas); our table is a thin, fast index layer

### Why clean break (no migration)

The platform is in early testing. There are minimal existing sessions worth migrating. New sessions use Convex persistence. If any legacy sessions exist, they can still be loaded from OpenCode if the sandbox is alive — but we're not building dedicated fallback infrastructure for this.

## Harness Agnosticism

This architecture is harness-agnostic by design. The persistence layer (DeltaStreamer → Convex tables) doesn't know or care which harness generated the events. A `HarnessAdapter` interface normalizes harness-specific events into the standard `UIMessageStream` format:

```
OpenCode events  ─┐
OpenHands events  ─┼──→ normalizeToUIStream() ──→ DeltaStreamer ──→ Convex
Goose events     ─┘
```

Daytona handles harness provisioning inside the sandbox. Our adapter layer handles event translation. Convex handles persistence. Each concern is isolated.

Adding a new harness means writing one adapter file. No changes to persistence, UI, or client code.

## What This Enables

With messages in Convex, the following become possible without additional persistence work:

| Feature | How it uses message persistence |
|---|---|
| **Vercel Workflow** | Background tasks use the same action → DeltaStreamer path. Messages persist across retries and crashes. |
| **Multi-channel (Chat SDK)** | Slack/Telegram adapters read and write to the same Convex threads. Shared history. |
| **Message search** | Full-text search on the component's messages table (built-in search index). |
| **Agent memory** | Component has built-in memory with embeddings. Enable per-agent. |
| **Thread branching** | Component supports `parentThreadIds` for forking conversations. |
| **Analytics** | Query message tables for usage metrics, token counts, conversation quality. |
| **Multi-device** | Open on phone and laptop — same thread, same stream, real-time sync. |

## Consequences

### Positive
- Messages survive anything (sandbox crashes, tab closes, redeployments)
- Real-time multi-client sync via WebSocket (no SSE)
- Page refresh shows all messages including active streams
- Eliminates custom streaming plumbing (~300 lines in chat route)
- Standard UIMessage format throughout the stack
- Foundation for every major feature on the roadmap

### Negative
- New dependency (`@convex-dev/agent`, `convex-helpers`)
- Convex action has 10-minute timeout (sufficient for interactive chat, not for very long autonomous tasks — those need Vercel Workflow)
- Migration effort: rewrite chat data flow (API route → Convex action, SSE → WebSocket)
- assistant-ui wiring changes (useChatRuntime → useExternalStoreRuntime)

### Risks
- Convex action holding a long SSE connection to OpenCode — needs testing for reliability
- `@convex-dev/agent` is v0.6.1 (pre-1.0) — API may change, though it's first-party Convex
- OpenCode event format may change — isolated in adapter, easy to fix

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Keep SSE + persist on finish | No real-time multi-client sync. Page refresh loses stream. Doesn't scale to background tasks. |
| Custom Convex tables | Reinventing what `@convex-dev/agent` already provides. Maintenance burden. |
| Move LLM calls into Convex (no OpenCode) | Loses harness ecosystem (tools, browser, file system). OpenCode/OpenHands provide the agent runtime, not just LLM calls. |
| Supabase/Postgres for messages | Adds a third data store. No reactive subscriptions. Doesn't integrate with Convex auth or queries. |
