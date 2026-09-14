# Agent Memory Architecture Research

> Source: Deep Agents blog — "Memory isn't a plugin, it's the harness"
> (Sarah Wooders / Letta AI), plus internal analysis of Dispatch's
> current state and Viktor's approach.
>
> Date: April 2026

---

## Core Thesis

Memory is inseparable from the agent harness. If you don't own your
harness, you don't own your memory. Memory is what makes agents get
better over time, creates sticky user experiences, and builds a
proprietary dataset that can't be replicated by competitors with the
same tools and prompts.

**"Without memory, your agents are easily replicable by anyone who has
access to the same tools. With memory, you build up a proprietary
dataset — a dataset of user interactions and preferences."**

---

## The Spectrum of Memory Ownership

### Fully Open (target state)

```
┌─── Your Harness (you own) ──────────────────┐
│                                              │
│  ┌─ Long-term memory ──────────────────┐    │
│  │  Cross-session facts, preferences,  │    │
│  │  learned behaviors, domain knowledge│    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─ Short-term memory ─────────────────┐    │
│  │  Current conversation messages,     │    │
│  │  tool call results, working context │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─ Tools ─────────────────────────────┐    │
│  │  Composio, bash, file I/O, search   │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─ Prompt ────────────────────────────┐    │
│  │  Persona + injected memories        │    │
│  └─────────────────────────────────────┘    │
│                                              │
└──────────────────────────────────────────────┘
         ↕ API calls only
┌─── Model Provider API ──────────────────────┐
│  LLM (stateless — no memory here)           │
└──────────────────────────────────────────────┘
```

You own BOTH memory layers. The model is stateless — just an API.
You can swap models without losing anything.

### Partially Closed (common trap)

Short-term memory moves behind the model provider's API (server-side
compaction, stateful sessions). You can still feed in long-term
memory, but you don't control what the model remembers within a
conversation.

### Black Box (worst case)

Long-term memory is behind someone else's API. You can't see it,
can't export it, can't use it with a different model. Switching
providers means starting from zero.

**Dispatch must stay at "Fully Open."**

---

## Dispatch's Current State

### What we have

| Layer | Implementation | Ownership |
|---|---|---|
| Short-term memory | OpenCode manages conversation context within sessions | **Mixed** — OpenCode handles compaction (opaque), we mirror messages to Convex `agentMessages` |
| Persistent automation sessions | All runs of one automation share a single OpenCode session | **Owned** — session ID stored in Convex, messages mirrored |
| Session storage | Convex `agentSessions` + `agentMessages` tables | **Owned** |
| Sandbox filesystem | Daytona persistent volumes | **Owned** |

### What we don't have

| Layer | Status | Impact |
|---|---|---|
| **Working memory** (per-agent, cross-session) | Does not exist | Agent can't learn user preferences, team structure, recurring patterns. Every new session starts cold. |
| **Long-term knowledge base** | Does not exist | No accumulated institutional knowledge. Agent can't answer "what did we discuss last week?" |
| **Memory injection** | Does not exist | Even if we stored memories, there's no mechanism to inject relevant ones into the context at turn start |
| **Agent memory tools** | Do not exist | Agent has no way to explicitly save or recall facts. Memory can only happen implicitly via session history. |

### The compaction problem

OpenCode compresses long conversations internally. We don't control:
- What's kept vs. dropped during compaction
- The format of compacted summaries
- Whether critical facts survive compaction

This means even within a persistent session, important information
can be silently lost. The agent might forget a preference that was
mentioned 50 messages ago.

---

## What Viktor Does (validated approach)

From Peter Albert's engineering post:

> "We tried many approaches — vector databases, RAG pipelines,
> summary-based context injection. We landed on something surprisingly
> simple: **markdown files on a shared filesystem.** Each file
> accumulates institutional knowledge over time. We tried more
> sophisticated approaches. They all performed worse than plain text
> that the model can read and write directly."

Viktor's approach:
1. Each integration has a "skill file" — plain markdown
2. The agent reads relevant skill files at the start of each turn
3. The agent writes back to skill files after learning new information
4. Files live on the agent's filesystem (persistent)
5. Metadata is lazy-loaded via one-line summaries

**Why it works**: The agent manages its OWN memory explicitly. It
decides what to remember, how to organize it, and when to update it.
The harness facilitates this but doesn't make the decisions.

---

## Three-Layer Memory Model for Dispatch

### Layer 1: Session Memory (short-term) — HAVE IT

**What**: Messages in the current conversation.

**Where**: OpenCode manages the live context. Convex `agentMessages`
stores the full history.

**How it works today**: Each message is part of the OpenCode session.
When context fills up, OpenCode compacts. We mirror to Convex for
the web UI.

**Improvement needed**: After compaction, we should store a
Convex-side summary of what was compacted — so we have a record of
what the agent "forgot" and can re-inject critical facts if needed.

### Layer 2: Agent Memory (working memory) — NEED TO BUILD

**What**: Facts the agent accumulates across ALL interactions, ALL
channels, ALL automations.

**Examples**:
```
- Anurag prefers concise bullet-point responses
- The team uses Linear for project tracking (workspace: dispatch-eng)
- Dave is the CTO, Sarah handles billing, Idan handles DevOps
- The "billing bug" refers to LIN-423 (reconcile subscription tier)
- When someone asks about "the API", they mean the Composio API
- Customer support tickets go to #customer-questions in Slack
- The weekly standup is Mondays at 9am Pacific
```

**Where it should live**: Convex `agentMemories` table.

**Schema sketch**:
```ts
agentMemories: defineTable({
  agentId: v.id("agents"),
  
  // What kind of memory this is
  type: v.union(
    v.literal("user_preference"),   // how a user likes things done
    v.literal("team_fact"),         // who's who, what's what
    v.literal("integration_note"), // learned behavior about a tool
    v.literal("domain_knowledge"), // recurring patterns, definitions
    v.literal("general"),          // anything else
  ),
  
  // The memory content — plain text, human-readable
  content: v.string(),
  
  // Short summary for the injection picker (which memories to load)
  summary: v.string(),
  
  // Optional: who/what this memory relates to
  relatedTo: v.optional(v.string()),
  
  // When this was learned and last confirmed
  createdAt: v.number(),
  updatedAt: v.number(),
  
  // How many times this memory has been useful (accessed/referenced)
  accessCount: v.optional(v.number()),
  
  // Source: which session/channel/automation taught us this
  source: v.optional(v.string()),
})
  .index("by_agent", ["agentId"])
  .index("by_agent_and_type", ["agentId", "type"])
  .searchIndex("search_content", {
    searchField: "content",
    filterFields: ["agentId"],
  }),
```

**How it works**:

1. **Injection at turn start**: Before each agent turn, query the
   agent's memories and inject a summary into the system prompt:
   ```
   ## What you know about this workspace
   - Anurag prefers bullet-point responses
   - Team uses Linear (dispatch-eng workspace)
   - Dave = CTO, Sarah = billing, Idan = DevOps
   ```

2. **Agent tools for memory management**:
   - `remember(content, type)` — save a new memory
   - `recall(query)` — search memories by keyword/semantic
   - `forget(id)` — remove an outdated memory
   - `update_memory(id, content)` — correct a memory

3. **Automatic extraction**: After significant interactions (not every
   message — that would be noisy), run a lightweight extraction pass:
   "Did the agent learn anything new in this conversation? If so,
   what?" Store the result as a memory.

4. **User visibility**: The agent management page shows a "Memory"
   section where users can see, edit, and delete what the agent
   remembers. This builds trust — users can correct wrong memories
   and verify the agent knows what it should.

### Layer 3: Knowledge Base (long-term) — FUTURE

**What**: Indexed, searchable collection of everything the agent has
ever processed — interaction summaries, automation outcomes, document
contents, integration state.

**Where**: Convex with vector embeddings (via Convex's built-in
vector search or an external embedding service).

**When**: After Layer 2 is proven. Layer 2 is the MVP — explicit
memories the agent manages. Layer 3 is the scale play — automatic
indexing of everything.

---

## Implementation Approach

### Phase 1: Memory as agent tools (Viktor approach, Convex-native)

1. Add `agentMemories` table to Convex schema
2. Create `remember`, `recall`, `forget` as OpenCode tools
   (injected via the MCP config, alongside Composio)
3. At each turn start, inject the top-N most relevant memories
   into the system prompt
4. Add "Memory" section to the agent management page

**Scope**: ~3-4 days. Builds on the existing Composio MCP injection
pattern — we already know how to add tools to the agent's config.

### Phase 2: Automatic memory extraction

After significant interactions, run a cheap LLM pass (Haiku) that
extracts facts worth remembering. Store as memories automatically.
The agent doesn't have to explicitly call `remember()` — the system
does it for them.

**Scope**: ~2 days. Similar to the classifier in the channel scanner.

### Phase 3: User-visible memory management

Add a "Memory" tab to the agent management page showing all stored
memories. Users can:
- Read what the agent remembers
- Edit incorrect memories
- Delete outdated ones
- See when each memory was created and last accessed

**Scope**: ~2 days. Standard CRUD UI.

### Phase 4: Knowledge base with vector search

Add embeddings to memories for semantic search. When the agent needs
to recall something, it can search by meaning, not just keywords.
Also index automation run summaries and interaction transcripts.

**Scope**: ~1 week. Requires embedding pipeline + Convex vector
search setup.

---

## Key Design Principles

1. **Memory lives in Convex, not in OpenCode.** OpenCode is the
   runtime, Convex is the persistence layer. We can swap harnesses
   without losing memories.

2. **The agent manages its own memory.** Like Viktor's skill files,
   the agent decides what to remember. We facilitate, we don't
   dictate.

3. **Memory is inspectable.** Users can see, edit, and delete what
   the agent remembers. No black boxes.

4. **Memory is injected, not searched on every turn.** At turn start,
   we pick the most relevant memories and put them in the prompt.
   The agent doesn't have to call a tool to know its own memories.

5. **Start simple, add sophistication later.** Phase 1 is plain text
   memories with keyword search. Phase 4 is vector embeddings. Both
   are valid — don't let Phase 4's complexity block Phase 1.

6. **Memory makes agents irreplaceable.** A Dispatch agent with 3
   months of accumulated memory about a customer's team, preferences,
   and workflows can't be replicated by a competitor in a day. This
   is the moat.

---

## What the Blog Implies for Dispatch

These are the non-obvious conclusions — not just "we need memory" but
what it MEANS for our architecture, product, and strategy.

### 1. OpenCode's compaction is a hidden memory decision we don't control

When a session gets long, OpenCode compresses it. That compression IS
a memory decision — it chooses what to keep and what to drop. We have
no input. A critical fact ("Dave prefers Jira, not Linear") mentioned
50 messages ago could be silently dropped because the compressor
didn't think it was important.

**Conclusion**: Treat OpenCode sessions as EPHEMERAL short-term
memory. Everything important must exist OUTSIDE the session, in
Convex, where we control it. The persistent automation session is a
step forward but still subject to compaction loss.

### 2. Tools are commodity — memory is the moat

Anyone can connect the same Composio tools. Anyone can call the same
Claude API. What nobody can replicate is 3 months of accumulated
knowledge about THIS customer's team, preferences, workflows, and
patterns.

Right now, if a Dispatch user churns, they lose nothing — because
there IS nothing accumulated. Their agent is a prompt + tool list. A
competitor replicates it in 10 minutes.

With memory: "Your agent has learned 47 facts about your team,
handled 340 automation runs, and knows your naming conventions,
escalation preferences, and communication style." Leaving means
starting from zero.

**Conclusion**: Memory isn't a feature to add later. It's the
product strategy for retention. Ship it early, even if simple.

### 3. The harness is ALREADY swappable (we're ahead of the blog's concern)

Dispatch's runtime adapter pattern (`createRuntimeAdapter(previewUrl)`)
already abstracts the harness. Sessions live in Convex. Messages live
in Convex. Tools come via MCP (standard protocol). OpenCode is an
implementation detail — we could swap it for any runtime that speaks
the same interface.

The blog's Implication 3 ("you might outgrow your harness") is LESS
urgent for us because we already designed for swappability. The REAL
remaining risk is that the only "memory" today lives inside OpenCode's
session state. Once we move memory to Convex, even that dependency
is eliminated.

**Conclusion**: The runtime adapter pattern was the right call. The
last piece is moving long-term memory from "inside the harness" to
"inside our database." Then the harness is truly stateless from our
perspective.

### 4. Memory should be USER-FACING, not invisible plumbing

The blog's deleted-email-agent story: the author didn't know how much
the agent had learned until it was gone. If memory had been visible,
they would have valued the product more, backed up knowledge, and
corrected mistakes early.

For Dispatch's ops-manager users, "what does my agent know?" must be
answerable from the UI. This is a trust signal — the same way a new
agent showing "here's what I've learned so far" builds confidence.

**Conclusion**: Memory needs a dedicated section in the agent
management page. Visible, editable, exportable. Not hidden behind
logs or session history.

### 5. Don't over-engineer Phase 1

Viktor tried vector databases, RAG pipelines, and summary-based
injection — and landed on plain markdown files. The blog agrees
memory is early and best practices don't exist yet.

The Dispatch MVP: plain text memories in Convex, injected into
prompts, agent tools for CRUD. No embeddings, no RAG, no retrieval
pipeline. That's Phase 1. Sophistication comes in Phase 4 when we
know what works.

**Conclusion**: Ship remember/recall/forget as agent tools + a memory
section in the UI. See what agents actually learn. Iterate from there.

### 6. The one-sentence strategic takeaway

**Memory is what turns "AI tool" into "AI agent." Without it,
we're selling a commodity. With it, we're selling something
irreplaceable. And it must live in OUR database, not in anyone
else's runtime.**

---

## References

- Sarah Wooders (Letta AI): "Why memory isn't a plugin (it's the harness)"
- Peter Albert (Viktor/Zeta Labs): "What Breaks When Your Agent Has 100,000 Tools"
- Deep Agents blog: "Memory should be open, so that you own your own memory"
- OpenCode source: uses session-based context with file-system persistence
- Claude Code: CLAUDE.md + auto-memory as a lightweight working memory example
