# Lessons From Claude Code

What Claude Code appears to do especially well, and what Dispatch V2 can borrow from it.

---

## Why This Matters

Dispatch V2 is not trying to copy Claude Code as a product.

But Claude Code is a strong reference for how a serious agent harness behaves when:
- conversations get long
- tools run concurrently
- permissions matter
- memory must stay useful over time
- interruptions and retries happen in the real world

OpenCode remains the first harness in Dispatch V2. These lessons are about product and orchestration patterns we should reproduce around it, while keeping the product layer swappable enough to support another harness such as Pi later.

---

## 1. Memory Should Be Maintained, Not Just Stored

Claude Code does not treat memory as a passive dump of notes.

From the source in `services/SessionMemory/` and `services/extractMemories/`, it maintains session memory in the background using threshold-based extraction and forked agent flows. Memory updates happen after enough context growth or tool activity, instead of after every turn.

### What to borrow

- Keep runtime memory file-first on the agent volume
- Update memory periodically, not continuously
- Extract durable facts and summaries off the critical path
- Use a background subagent/forked run to maintain memory files
- Separate durable memory from short-lived working notes

### What this means for Dispatch

Recommended memory layout:

- `AGENTS.md` for role, permissions, tone, and operating rules
- `memory/profile.md` for stable customer/business facts
- `memory/playbook.md` for SOPs and vertical guidance
- `memory/contacts.json` for structured people/channel bindings
- `memory/working-notes/` for temporary summaries and active context
- `Convex` for indexing, editor state, summaries, bindings, and approvals

---

## 2. Compaction Needs Layers

Claude Code appears to use multiple context management strategies rather than one blunt summarization pass:

- microcompact
- autocompact
- context collapse
- session-memory-aware compaction
- circuit breakers when repeated compaction fails

This is a strong pattern.

### What to borrow

- Preserve granular context as long as possible
- Compact in stages instead of jumping straight to one large summary
- Add hard limits and fallback behavior when context stays too large
- Keep memory extraction and compaction aware of each other
- Prefer summaries of stale context, not the newest active working set

### What this means for Dispatch

Even if OpenCode handles most of the harness-level compaction, Dispatch should still design product-level context boundaries:

- current thread context
- durable memory
- run summaries
- per-channel thread summaries
- pack/playbook context

Do not let every historical interaction stay equally “live”.

---

## 3. Tool Execution Needs Real Orchestration

Claude Code’s tool execution logic is notably disciplined.

From `services/tools/toolOrchestration.ts` and `services/tools/StreamingToolExecutor.ts`, it appears to:

- distinguish concurrency-safe vs exclusive tools
- run safe reads concurrently
- serialize unsafe or mutating tools
- preserve message/result ordering
- synthesize tool results on interruption or failure so transcripts remain coherent
- track in-progress tool IDs explicitly

### What to borrow

- Mark each Dispatch tool as one of:
  - read-only and concurrency-safe
  - mutating and exclusive
  - side-effectful and approval-gated
- Preserve a clean tool/result transcript even when tools are interrupted
- Make cancellation a normal code path, not an edge case
- Keep concurrent reads fast without allowing unsafe writes to race

### What this means for Dispatch

Good initial tool buckets:

- Safe concurrent: `read`, `grep`, `glob`, passive browser reads
- Exclusive: `edit`, `write`, `memory update`, file uploads
- Approval-gated: `email send`, `message send`, external posting, destructive shell actions
- Isolated compute: `computer` for untrusted or heavy work

---

## 4. Permissions Should Be Runtime-Native

Claude Code treats permissions as a core part of execution, not a UI-only concept.

That is exactly right for Dispatch because agents will eventually touch real customer systems, not just local files.

### What to borrow

- Explicit `allow` / `ask` / `deny` semantics per tool
- Path- or command-level constraints where applicable
- Different interruption behavior depending on tool type
- First-class approval state in the runtime and control plane

### What this means for Dispatch

Permissions should live in two places:

- `AGENTS.md` / runtime config for what the agent is allowed to do
- `Convex` for approval state, audit trail, and operator-visible policy

This is especially important for:

- email
- Slack / Telegram / Teams / GitHub outbound actions
- browser actions with side effects
- destructive shell/file commands

---

## 5. Background Work Should Use Forked or Sidecar Runs

Claude Code repeatedly uses forked-agent style background work for memory and related tasks.

This is a good fit for Dispatch.

### What to borrow

- Use sidecar or forked runs for:
  - memory extraction
  - thread summarization
  - run summarization
  - post-run classification
  - cost/accounting finalization if needed
- Keep the user-facing turn responsive while sidecar work finishes after

### What this means for Dispatch

A completed agent run should often trigger follow-up work:

- summarize what happened
- extract durable memory
- update per-channel thread summary
- mirror product-visible metadata into Convex

That should happen after the main response, not during it.

---

## 6. Product Memory And Harness Memory Are Different

Claude Code reinforces an important distinction:

- harness memory = what the runtime needs to continue reasoning
- product memory = what the application needs to show, search, bill, audit, and control

### What to borrow

- Do not force one store to do both jobs
- Keep raw session history close to the harness
- Mirror product-critical state into the control plane

### What this means for Dispatch

Use:

- `OpenCode + Daytona volume` for raw session history, files, config, and runtime memory
- `Convex` for agent records, runs, approvals, bindings, summaries, and billing metadata

This keeps the runtime flexible and the product layer clean.

---

## 7. Dispatch Should Stay Opinionated

Claude Code is useful because it is not a random collection of tools. It has strong opinions about:

- when to compact
- when to summarize
- how to run tools
- how to respect permissions
- how to preserve coherent transcripts

Dispatch should do the same for agents.

### What to borrow

- Opinionated defaults beat maximum flexibility at the start
- Vertical AI agents should come with:
  - a role
  - a playbook
  - a permission policy
  - a memory structure
  - a channel strategy

### What this means for Dispatch

Agent packs should not just be prompts. They should bundle:

- instructions
- tool permissions
- memory templates
- integration expectations
- channel behavior
- approval rules

That is what makes an agent pack a product, not just a preset.

---

## Recommended Actions For V2

1. Keep memory file-first on the Daytona volume.
2. Mirror only product-critical summaries and indexes into Convex.
3. Add threshold-based background memory extraction after core chat is working.
4. Classify all tools by concurrency and approval requirements.
5. Preserve coherent tool/result transcripts even on cancellation or failure.
6. Treat agent packs as full operating templates, not just prompts.
7. Keep OpenCode as the harness, but build strong product behavior around it.

---

## Bottom Line

The biggest lesson from Claude Code is not “add more features.”

It is this:

Reliable agent systems come from disciplined handling of memory, context, tools, permissions, and interruptions.

That is exactly the layer Dispatch should be excellent at while OpenCode handles the base harness.
