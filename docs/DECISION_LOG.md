# Decision Log

Tracks major architectural decisions, trade-offs, and pivots. Newest first.

---

## 2026-04-05: Hybrid Architecture — Vercel Compute + Convex Persistence

**Context:** We implemented full Convex action-based chat (DeltaStreamer writing deltas to Convex every 100ms). During smoke testing, two problems surfaced:

1. **Cost** — Every message = a long-running Convex action (30s-2min compute) + ~200 delta writes. At scale this would cost ~100x more on Convex than persisting only completed messages.

2. **Multi-channel architecture** — Most agent interactions will come from external channels (Slack, Telegram, Teams) via Chat SDK. These channels don't need real-time streaming — they get a complete response. Running all of these through Convex actions makes Convex the compute layer, which is wrong. Convex is a database.

3. **Env var split** — Convex actions run on Convex's servers, so Daytona/OpenRouter credentials need to be duplicated there. Adds operational complexity.

**Decision:** Switch to hybrid architecture.

| Layer | Responsibility | Technology |
|---|---|---|
| Compute | HTTP handling, SSE streaming, background tasks | Vercel (API routes, Workflow) |
| Sandbox | Agent execution, harness management | Daytona |
| Persistence | Messages, auth, real-time subscriptions | Convex + `@convex-dev/agent` |
| UI | Rendering, real-time updates | assistant-ui + Convex subscriptions |

**Data flow:**
- Web chat: Vercel API route → Daytona/OpenCode → SSE to client → `onFinish` persists to Convex
- Channels: Vercel Workflow → Daytona → persist to Convex → reply to channel
- Dashboard: Convex reactive queries (useUIMessages, useQuery)

**What we keep from the full Convex approach:**
- `@convex-dev/agent` component (threads, messages tables)
- `useUIMessages` for reading persisted message history
- Thread management (createThread, sessions linked to threads)
- Schema changes (threadId on agentSessions)

**What we revert:**
- Convex action for chat (`chatActions.ts` execute) → back to Next.js API route
- DeltaStreamer mid-stream persistence → `onFinish` complete-message persistence
- Client `useExternalStoreRuntime` → back to `DefaultChatTransport` + `useChatRuntime`

**Trade-off accepted:** Page refresh mid-stream loses the in-progress text. This is acceptable at current stage. Can add DeltaStreamer back later if needed (the component is already installed).

**What this enables:**
- Chat SDK multi-channel (Vercel Workflow, not Convex actions)
- LLM proxy/billing (Vercel API route, uses existing creditLedger)
- Future harness swaps (Rivet actors, OpenHands) — same persistence layer
- Free tier (lightweight compute, no expensive Convex action per message)

---

## 2026-04-05: Convex Message Persistence with @convex-dev/agent

**Context:** Messages lived in OpenCode's SQLite inside Daytona sandboxes. Lost on sandbox restart. No cross-client sync. Blocks multi-channel, durable execution, search.

**Decision:** Adopt `@convex-dev/agent` as the persistence layer for messages and threads.

**Rationale:** First-party Convex library. Handles threads, messages, streaming deltas, pagination, text smoothing. Uses `UIMessage` format (AI SDK standard). Eliminates custom plumbing.

**What it provides:**
- Managed tables (threads, messages, streamingMessages, streamDeltas)
- `useUIMessages` hook for reactive client reads
- Thread management with ordering and pagination
- DeltaStreamer for real-time streaming persistence (available if needed later)
- `UIMessage` format compatibility with AI SDK and assistant-ui

**See also:** `docs/ARCHITECTURE_DECISION_MESSAGE_PERSISTENCE.md` for full rationale.

---

## 2026-04-05: Keep agentSessions as Index Layer

**Context:** `@convex-dev/agent` creates its own `threads` table but it lacks `agentId`. Need fast per-agent queries.

**Decision:** Keep our `agentSessions` table with a `threadId` field linking to the component's threads. Our table = fast index (O(log n) per-agent lookup). Component = heavy data (messages, deltas).

**Trade-off:** Two tables for session metadata. But the component's table is sandboxed (can't add custom indexes), and our table stays thin.

---

## 2026-04-05: Clean Break Migration (No Legacy Fallback)

**Context:** Platform is in early testing. Minimal existing sessions.

**Decision:** New sessions use Convex persistence. Old sessions without `threadId` are not shown. No migration code, no fallback paths.

---

## 2026-04-04: Harness-Agnostic Adapter Pattern

**Context:** Currently using OpenCode, but plan to support OpenHands, Goose, and potentially Rivet actors.

**Decision:** `HarnessAdapter` interface normalizes harness-specific events into standard `UIMessageStream` format. Each harness implements the interface. Persistence and UI layers are harness-agnostic.

**Impact:** Adding a new harness = one adapter file. No changes to persistence, UI, or client code.

---

## 2026-04-04: Vercel Workflow for Background Agent Tasks

**Context:** Crons, webhooks, and autonomous agent tasks need durable execution (retries, crash recovery, longer than serverless limits).

**Decision:** Use Vercel Workflow for background/autonomous tasks. Keep SSE streaming for interactive web chat. Two execution paths, same persistence layer.

**Status:** Design decision made. Implementation pending (after message persistence is stable).
