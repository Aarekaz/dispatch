# Dispatch v2: Vertical AI Agent Platform

## The Simple Idea

Each vertical agent = a **runtime harness** running in a **Daytona sandbox** with a **persistent volume**.

That's it. OpenCode is the first harness we will ship with (tool loop, sessions, compaction, permissions, multi-provider LLM), but Dispatch should stay harness-agnostic so we can also evaluate alternatives like Pi. Daytona is the computer (sandbox for compute, volume for state). Convex is the control plane (agents, runs, integrations, approvals, billing state, dashboards). Chat SDK is the multi-channel shell (Slack, Telegram, Teams, Discord, GitHub, Linear, and more). We add auth, billing, a frontend, and external tools on top.

We don't build a harness from scratch. We don't build a provisioner. We don't manage VMs. We compose existing infrastructure behind a Dispatch-owned runtime adapter layer.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    VERCEL (Next.js)                       │
│                                                           │
│  Frontend          API Routes             Crons           │
│  ┌───────────┐    ┌────────────────┐    ┌──────────┐    │
│  │ Chat UI   │───→│ /api/agents/   │    │ /api/cron│    │
│  │ Dashboard │    │   [id]/chat    │    │   /tick  │    │
│  │ Settings  │    │                │    └────┬─────┘    │
│  └───────────┘    │ 1. Auth+credits│         │          │
│                   │ 2. Ensure sand-│         │          │
│                   │    box running │         │          │
│                   │ 3. OpenCode SDK│         │          │
│                   │    → prompt()  │         │          │
│                   │ 4. Stream back │         │          │
│                   └───────┬────────┘         │          │
└───────────────────────────┼──────────────────┼──────────┘
                            │                  │
                    OpenCode SDK         OpenCode SDK
                     (prompt)             (run/prompt)
                            │                  │
┌───────────────────────────┴──────────────────┴──────────┐
│                 DAYTONA (per agent)                       │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  SANDBOX (starts <100ms, auto-stops after idle)      │ │
│  │                                                      │ │
│  │  opencode serve --port 4096                          │ │
│  │                                                      │ │
│  │  Built-in tools:        Our custom tools (plugins):  │ │
│  │  - bash                 - browser (Browserbase)      │ │
│  │  - read/write/edit      - email (Gmail)              │ │
│  │  - glob/grep            - calendar (GCal)            │ │
│  │  - subagent             - message (Telegram/Slack)   │ │
│  │  - web_fetch            - computer (spawn sandbox)   │ │
│  │  - web_search           - memory (volume/Convex)     │ │
│  │                                                      │ │
│  │  Sessions, compaction, permissions = OpenCode native  │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │ mounted                        │
│  ┌──────────────────────┴──────────────────────────────┐ │
│  │  VOLUME (persistent, S3-backed, shared-capable)      │ │
│  │                                                      │ │
│  │  /home/daytona/agent/                                │ │
│  │  ├── workspace/         # Agent working files        │ │
│  │  ├── .opencode/         # OpenCode config + sessions │ │
│  │  │   ├── config.json    # Model, provider, settings  │ │
│  │  │   ├── agents/        # Custom agent definitions   │ │
│  │  │   ├── plugins/       # Our custom tool plugins    │ │
│  │  │   └── db/            # SQLite (sessions, msgs)    │ │
│  │  ├── AGENTS.md          # Agent persona/instructions │ │
│  │  └── .env               # API keys, secrets          │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Additional sandboxes (spawned by agent as needed):      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Isolated     │  │ Shared vol  │  │ Ephemeral   │     │
│  │ code exec    │  │ batch job   │  │ one-off     │     │
│  │ (own volume) │  │ (same vol)  │  │ (no volume) │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                    SHARED SERVICES                        │
│                                                           │
│  Convex            Chat SDK            External APIs      │
│  - users           - Telegram          - Browserbase      │
│  - agents          - Slack             - Stripe           │
│  - runs/events     - Teams             - LLM providers    │
│  - billing         - Discord           - Composio         │
│  - integrations    - GitHub                               │
│  - approvals       - Linear                               │
│  - crons           - More adapters                         │
└──────────────────────────────────────────────────────────┘
```

---

## Why This Works

### Runtime Adapter Principle

Dispatch should be harness-agnostic.

That means the product layer should speak in Dispatch concepts:

- agent
- run
- session
- runtime event
- tool policy
- memory binding
- approval

Only the runtime adapter layer should know whether the backing harness is OpenCode, Pi, or something else.

Initial adapters:

- `OpenCodeRuntimeAdapter` — first production runtime
- `PiRuntimeAdapter` — experimental/alternate runtime candidate

This keeps Dispatch from overfitting its entire product model to one harness's event names, storage layout, or permission semantics.

### Computer Layer Decision

Default choice: **Daytona**

Why:
- cleaner separation between computer layer and harness layer
- works well with a Dispatch-owned runtime adapter boundary
- keeps `OpenCodeRuntimeAdapter` and `PiRuntimeAdapter` viable
- already fits the agent model of persistent workspaces plus sandbox lifecycle

Evaluation candidate: **OpenComputer**

Why it is interesting:
- stronger integrated computer-use story
- built-in long-running VM sessions, checkpoints, and forking
- may be attractive for agent packs centered around deep desktop/UI automation

Why it is not the default:
- it is closer to a combined computer + harness platform than a pure computer primitive
- increases coupling to one agent/session model
- makes Dispatch's harness-agnostic architecture harder to preserve

Decision for now:
- use Daytona as the default computer layer
- prototype OpenComputer for computer-use-heavy agent packs
- only switch if computer use becomes the primary moat and the integration benefits clearly outweigh the coupling cost

**What OpenCode gives us for free as the first runtime adapter:**
- Tool loop (LLM call → tool execution → loop) — battle-tested, 112K+ stars
- Session management (create, list, fork, delete)
- Context compaction (automatic when context fills up)
- Permission system (allow/ask/deny per tool, glob patterns for bash)
- Multi-provider LLM (Anthropic, OpenAI, Google, etc.)
- Streaming (SSE via event subscription)
- Subagents (task delegation to child agents)
- HTTP API + TypeScript SDK (`@opencode-ai/sdk`)
- MCP server support (can connect to external tool servers)
- Plugin system (for adding custom tools)
- File operations, bash, web search, web fetch — all built-in

**What Daytona gives us for free:**
- Sandbox creation in <100ms
- Auto-stop after idle (configurable, default 15min)
- Persistent volumes (S3-backed, shared across sandboxes, free)
- Volume subpaths (per-agent isolation on shared volumes)
- Computer Use support (desktop automation)
- SSH access
- TypeScript/Python/Go SDKs
- Per-second billing (only pay when running)

**What we build:**
- Auth + billing layer (Vercel API + Convex)
- Frontend (Next.js chat UI)
- Runtime-specific plugins/adapters for external tools (OpenCode first)
- Chat SDK orchestration layer (Telegram/Slack/Teams/etc. → agent routing)
- Agent CRUD + configuration management
- Credit tracking middleware

---

## Execution Patterns

### 1. Chat (interactive, on-demand)

```
User sends "Research competitor pricing"
  ↓
Vercel API:
  1. Verify auth + credits
  2. daytona.sandbox.start(agentSandboxId)  // <100ms if stopped
  3. opencode.session.prompt({ text: "Research competitor pricing" })
  4. Stream SSE events back to frontend
  ↓
Sandbox auto-stops after 15min idle
Volume persists (workspace files, session history, agent config)
```

### 2. Crons (scheduled, headless)

```
External scheduler fires at 9am Monday
  ↓
/api/cron/tick:
  1. Query Convex: which agents have crons due?
  2. For each: daytona.sandbox.start(agentSandboxId)
  3. opencode.session.prompt({ text: cronPrompt })
  4. Wait for completion, log result
  ↓
Sandbox auto-stops after done
```

### 3. Workflows (event-triggered)

```
Telegram/Slack/Teams message arrives
  ↓
Chat SDK:
  1. Normalize inbound thread/message from platform adapter
  2. Lookup: which agent owns this thread/channel?
  2. daytona.sandbox.start(agentSandboxId)
  3. opencode.session.prompt({ text: message })
  4. Stream response back through the platform adapter
  ↓
Sandbox auto-stops after idle
```

### 4. Persistent Processes (always-on)

```
Agent needs to run a web scraper 24/7
  ↓
Agent calls "computer" tool:
  1. daytona.create({ auto_stop_interval: 0, volumes: [agentVolume] })
  2. sandbox.exec("python scraper.py")
  3. Returns sandbox ID + preview URL
  ↓
Sandbox runs indefinitely (user pays for compute)
Agent can check on it, stop it, read its output via volume
```

### 5. Isolated Compute (sandboxes as tools)

```
Agent needs to run untrusted code from a user
  ↓
Agent calls "computer" tool:
  1. daytona.create({ ephemeral: true })  // No volume = isolated
  2. sandbox.exec(userCode)
  3. Collect output
  4. Sandbox auto-deletes on stop
  ↓
Main agent's volume is never exposed to untrusted code
```

### 6. Shared Compute (batch jobs)

```
Agent needs to process 1000 files in parallel
  ↓
Agent calls "computer" tool:
  1. Create 10 sandboxes, all mounting the SAME volume
  2. Each processes 100 files
  3. Results written to volume
  4. All sandboxes stop when done
  ↓
Agent reads results from its own volume
```

---

## State & Permissions Model

### What lives WHERE:

| State | Location | Why |
|-------|----------|-----|
| Agent workspace files | Daytona Volume | Persists across sandbox restarts. The agent operates on these directly. |
| OpenCode sessions + messages | SQLite on Volume + Convex (lazy sync) | Runtime source of truth on volume. Run summaries mirrored to Convex so UI can show history without waking sandbox. |
| OpenCode config + agents | Files on Volume | `.opencode/config.json`, `AGENTS.md` — portable, versionable. |
| User accounts, billing state | Convex | Shared product state for plans, balances, entitlements, and dashboards. |
| Agent registry (which user owns which agent) | Convex | Queried by API without starting the sandbox. |
| Credit ledger | Convex | Transactional app-level usage/accounting history. |
| Integration configs (Telegram/Slack/Teams/GitHub tokens, etc.) | Convex (encrypted) | Accessible by Chat SDK flows without starting the sandbox. |
| Agent memories | Volume (markdown files) OR Convex metadata index | Volume is simplest for runtime; Convex is best for dashboards/search/editor state. |
| Cron definitions | Convex | Queried by Vercel cron without starting the sandbox. |

### Recommended Memory Model

Keep memory simple and file-first.

- `AGENTS.md` = role, tone, permissions, operating rules
- `memory/profile.md` = durable facts about the customer, business, and owner
- `memory/playbook.md` = SOPs, workflows, escalation rules, vertical-specific guidance
- `memory/contacts.json` = structured people/account/channel bindings
- `memory/working-notes/` = short-lived notes, summaries, and in-progress context
- Convex = memory index, dashboard/editor state, approvals, thread bindings, and summaries

The Daytona volume should be the source of truth for runtime memory because OpenCode already works naturally with files. Convex should mirror only the product-critical metadata needed for search, editing, dashboards, and cross-channel routing.

### Chat Storage: Dual-Write Pattern

Chat messages use a dual-write pattern:

- **Volume SQLite** = runtime source of truth. OpenCode reads/writes during execution. Required for sessions, compaction, context management.
- **Convex** = product source of truth. UI reads for dashboards, search, history. Real-time reactivity. No sandbox wake needed.

On `session.completed` SSE events, the API route writes a run summary to Convex. Start with lazy sync (run summaries only). Add full message sync later if users need instant history without sandbox wake.

### Daytona SDK Gotchas

- **Package is `@daytonaio/sdk`** (not `@daytona/sdk`)
- **No `.sandbox` namespace** — use `daytona.get(id)` then `sandbox.start()`, not `daytona.sandbox.get()`
- **File ops**: `downloadFile` / `uploadFiles([{source, destination}])` / `listFiles()` — not read/write/list
- **Preview URLs**: `getPreviewLink(port)` returns `{url, token}`, not a bare string
- **Volumes are FUSE-mounted** — slower than local filesystem. SQLite on FUSE may have performance issues. Test early.
- **Auto-stop timer** does NOT reset on background work. Only SDK calls, SSH, and preview URL hits reset it. Use keepalive pings or `autoStopInterval: 0` for active sandboxes.
- **Default resources** (1 vCPU, 1GB RAM) may be insufficient for OpenCode + MCP server. Specify higher at creation.

### Sandbox permission levels:

```
ISOLATED (ephemeral sandbox, no volume):
  - Can't access agent's files
  - Can't access other sandboxes
  - Auto-deletes on stop
  - Use case: untrusted code execution

STANDARD (sandbox + agent's volume):
  - Full read/write to agent's workspace
  - Can't access other agents' volumes
  - Auto-stops after idle
  - Use case: normal agent operations

SHARED (sandbox + shared volume):
  - Multiple agents/sandboxes access same volume
  - Use case: team workspaces, batch processing

PERSISTENT (sandbox, no auto-stop):
  - Runs indefinitely
  - Use case: long-running processes, monitoring
```

---

## The "Computer" Tool

This is the key tool that gives agents the ability to spawn additional compute. The PRIMARY sandbox (running OpenCode) IS the agent's main computer. This tool creates ADDITIONAL computers when needed.

```typescript
// OpenCode plugin: computer tool
export const computerTool = {
  name: 'computer',
  description: `Spawn an additional computer (Daytona sandbox) for isolated or heavy tasks.
Use this when you need:
- Isolated environment for untrusted code
- Heavy compute that shouldn't block your main session
- Parallel processing across multiple machines
- A persistent process that runs in the background

Your main sandbox already has bash and file access — only use this
tool when you need ADDITIONAL or ISOLATED compute.`,

  parameters: {
    task: 'string — what to run',
    isolated: 'boolean — if true, no access to your files (default: false)',
    persistent: 'boolean — if true, keeps running after task completes (default: false)',
    image: 'string — custom container image (optional)',
  },

  async execute({ task, isolated, persistent, image }) {
    const sandbox = await daytona.create({
      image: image ?? 'ubuntu:22.04',
      volumes: isolated ? [] : [{ volumeId: agentVolumeId, mountPath: '/workspace' }],
      autoStopInterval: persistent ? 0 : 15,
      ephemeral: isolated,
    });

    const result = await sandbox.process.executeCommand(task);

    if (!persistent) {
      await sandbox.stop();
    }

    return {
      output: result.output,
      sandboxId: persistent ? sandbox.id : undefined,
      previewUrl: persistent ? (await sandbox.getPreviewLink(8080)).url : undefined,
    };
  },
};
```

---

## API Design

Thin. The Vercel API is a proxy layer — auth, credits, and routing. The real work happens in the runtime harness through a Dispatch-owned adapter.

### Runtime Adapter Interface

Dispatch should define its own runtime interface and keep harness-specific logic behind it.

```typescript
interface AgentRuntimeAdapter {
  createSession(agentId: string): Promise<{ sessionExternalId: string }>
  prompt(input: {
    agentId: string
    sessionExternalId: string
    message: string
  }): Promise<AsyncIterable<RuntimeEvent>>
  listSessions(agentId: string): Promise<RuntimeSessionSummary[]>
  getSessionMessages(input: {
    agentId: string
    sessionExternalId: string
  }): Promise<RuntimeMessage[]>
  cancelRun(input: {
    agentId: string
    sessionExternalId: string
  }): Promise<void>
  getUsage(eventStreamOrRunId: unknown): Promise<RuntimeUsage | null>
}
```

The product layer should store Dispatch-native fields like:

- `runtimeKind`
- `sessionExternalId`
- `runId`
- `status`
- `usage`
- `summary`

Instead of coupling the whole system to OpenCode-native naming.

### Agent Management (Convex-backed)

```
POST   /api/agents                    Create agent → creates Daytona volume + sandbox
GET    /api/agents                    List agents
GET    /api/agents/[id]               Get agent (config from Convex, status from Daytona)
PATCH  /api/agents/[id]               Update agent config → push to volume
DELETE /api/agents/[id]               Delete agent → destroy sandbox + volume
```

### Chat (proxied to OpenCode)

```
POST   /api/agents/[id]/chat          Send message → ensure sandbox → opencode.prompt() → SSE
POST   /api/agents/[id]/chat/cancel   Cancel → opencode.session.abort()
GET    /api/agents/[id]/sessions      List sessions → opencode.session.list()
GET    /api/agents/[id]/sessions/[s]  Get messages → opencode.session.messages()
DELETE /api/agents/[id]/sessions/[s]  Delete session → opencode.session.delete()
```

### Headless Runs

```
POST   /api/agents/[id]/run           Run prompt headlessly → opencode.session.prompt()
GET    /api/agents/[id]/runs          List past runs (from Convex run log)
```

### Crons

```
POST   /api/agents/[id]/crons         Create cron (stored in Convex)
GET    /api/agents/[id]/crons         List crons
PATCH  /api/agents/[id]/crons/[c]     Update
DELETE /api/agents/[id]/crons/[c]     Delete
POST   /api/cron/tick                  Scheduler dispatcher
```

### Files (proxied to sandbox)

```
GET    /api/agents/[id]/files?path=   List files → daytona.fs.listDir()
GET    /api/agents/[id]/file?path=    Read file → daytona.fs.readFile()
POST   /api/agents/[id]/file          Upload file → daytona.fs.uploadFile()
```

### Memory

```
GET    /api/agents/[id]/memory        List memories
POST   /api/agents/[id]/memory        Add/update memory
DELETE /api/agents/[id]/memory/[key]  Delete memory
```

### Integrations

```
GET    /api/agents/[id]/integrations
POST   /api/agents/[id]/integrations
DELETE /api/agents/[id]/integrations/[platform]
```

### Channel Routing

```
POST   /api/webhooks/telegram        Chat SDK Telegram adapter entrypoint
POST   /api/webhooks/slack           Chat SDK Slack adapter entrypoint
POST   /api/webhooks/teams           Chat SDK Teams adapter entrypoint
POST   /api/webhooks/github          Chat SDK GitHub adapter entrypoint
POST   /api/webhooks/linear          Chat SDK Linear adapter entrypoint
```

### Core Chat Endpoint Implementation

```typescript
// app/api/agents/[id]/chat/route.ts

import { createOpencodeClient } from '@opencode-ai/sdk';
import { Daytona } from '@daytonaio/sdk';

export async function POST(req: Request, { params }) {
  const user = await getAuthUser(req);
  const agent = await getAgent(params.id, user.id);
  const { message, sessionId } = await req.json();

  // 1. Check credits
  const balance = await getCredits(user.id);
  if (balance <= 0) return Response.json({ error: 'No credits' }, { status: 402 });

  // 2. Ensure sandbox is running
  const daytona = new Daytona();
  const sandbox = await daytona.get(agent.sandboxId);
  if (sandbox.state !== 'started') {
    await sandbox.start();
    await sandbox.waitUntilStarted();
    // Wait for OpenCode server to be ready
    const preview = await sandbox.getPreviewLink(4096);
    await waitForHealth(`${preview.url}/global/health`);
  }

  // 3. Connect to OpenCode
  const preview = await sandbox.getPreviewLink(4096);
  const opencode = createOpencodeClient({
    baseUrl: preview.url,
    auth: { username: 'opencode', password: agent.serverPassword },
  });

  // 4. Get or create session
  let sid = sessionId;
  if (!sid) {
    const session = await opencode.session.create({ body: {} });
    sid = session.data.id;
  }

  // 5. Send prompt and stream response
  const events = await opencode.event.subscribe();

  // Send prompt (async, response comes via events)
  opencode.session.prompt({
    path: { id: sid },
    body: { parts: [{ type: 'text', text: message }] },
  });

  // 6. Stream SSE events to frontend + mirror to Convex
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of events.stream) {
        controller.enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

        if (event.type === 'session.completed' || event.type === 'session.error') {
          // Track credits
          if (event.properties?.usage) {
            await deductCredits(user.id, agent.id, event.properties.usage);
          }
          // Mirror run summary to Convex (dual-write: lazy sync)
          await convex.mutation(api.runs.log, {
            agentId: agent.id,
            sessionId: sid,
            trigger: 'chat',
            status: event.type === 'session.completed' ? 'completed' : 'failed',
            summary: event.properties?.summary,
            usage: event.properties?.usage,
          });
          controller.close();
          break;
        }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
```

---

## Control-Plane Schema (Minimal)

We only store what CAN'T live on the volume or in OpenCode's native storage.

```typescript
// convex/schema.ts

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    subscriptionTier: v.string(),
    creditsBalance: v.number(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  teams: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.string(),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"]),

  agents: defineTable({
    userId: v.id("users"),
    teamId: v.optional(v.id("teams")),
    name: v.string(),
    slug: v.string(),
    vertical: v.string(),
    sandboxId: v.optional(v.string()),
    volumeId: v.optional(v.string()),
    serverPassword: v.optional(v.string()),
    model: v.string(),
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_team", ["teamId"])
    .index("by_user_slug", ["userId", "slug"]),

  // agentCrons removed — replaced by agentAutomations.
  // See automations framework: agents + triggers + instructions + delivery.

  agentIntegrations: defineTable({
    agentId: v.id("agents"),
    platform: v.string(),
    encryptedConfig: v.string(),
    channelBinding: v.optional(v.string()),
  })
    .index("by_agent", ["agentId"])
    .index("by_binding", ["channelBinding"]),

  creditLedger: defineTable({
    userId: v.id("users"),
    agentId: v.optional(v.id("agents")),
    amount: v.number(),
    reason: v.string(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_agent", ["agentId"]),

  agentRuns: defineTable({
    agentId: v.id("agents"),
    sessionId: v.optional(v.string()),
    trigger: v.string(), // chat, cron, webhook, manual
    status: v.string(),
    summary: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId"])
    .index("by_session", ["sessionId"]),
});
```

**Why so little control-plane state?**
- Sessions + messages → stored by OpenCode in SQLite on the volume
- Agent config → stored as files on the volume (AGENTS.md, .opencode/config.json)
- Agent memories → stored as files on the volume OR mirrored into Convex for search/editor UX
- Workspace files → on the volume
- Run history → summarized in Convex `agentRuns`; raw session detail stays in OpenCode

---

## Agent Configuration

Agents are configured via `AGENTS.md` on the volume — OpenCode's native format:

```markdown
# /home/daytona/agent/AGENTS.md

---
name: Atlas
model: anthropic/claude-sonnet-4-6
temperature: 0.7
maxSteps: 25
tools:
  bash: ask
  read: allow
  write: allow
  edit: allow
  browser: ask
  email: ask
  calendar: ask
  message: ask
  computer: ask
  memory: allow
bash_permissions:
  "git *": allow
  "npm *": ask
  "rm -rf *": deny
---

You are Atlas, a senior executive assistant.

## Your Owner
Michael is a startup founder running ClawCorp.

## What You Do
- Calendar management and meeting prep
- Email drafting in Michael's voice (direct, warm, no fluff)
- Research (companies, people, markets, competitors)
- Task management and follow-ups
- Automation and cron jobs

## How You Work
- Be proactive: if someone mentions a meeting, check the calendar
- Confirm before sending anything to real people
- Save important facts to memory
- When a task is complex, use subagents
```

---

## Custom Tools (OpenCode Plugins)

We extend OpenCode with our tools via its plugin system or MCP servers.

### Option A: MCP Server (cleanest)

Run an MCP server alongside OpenCode in the sandbox that provides our custom tools:

```typescript
// plugins/dispatch-mcp/src/index.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({ name: 'dispatch-tools' });

server.tool('browser', 'Browse a web page using Browserbase', {
  url: z.string(),
  instruction: z.string().optional(),
}, async ({ url, instruction }) => {
  const stagehand = new Stagehand({ env: 'BROWSERBASE' });
  await stagehand.init();
  await stagehand.page.goto(url);
  const content = instruction
    ? await stagehand.page.extract({ instruction, schema: z.object({ result: z.string() }) })
    : await stagehand.page.content();
  await stagehand.close();
  return { content: [{ type: 'text', text: JSON.stringify(content) }] };
});

server.tool('email_send', 'Send an email via Gmail', {
  to: z.string(),
  subject: z.string(),
  body: z.string(),
}, async ({ to, subject, body }) => {
  // Use Gmail API or Composio
  const result = await sendGmail(to, subject, body);
  return { content: [{ type: 'text', text: `Email sent to ${to}` }] };
});

server.tool('calendar_check', 'Check calendar events', {
  date: z.string().optional(),
}, async ({ date }) => {
  const events = await getCalendarEvents(date ?? 'today');
  return { content: [{ type: 'text', text: JSON.stringify(events) }] };
});

server.tool('message_send', 'Send a message through a connected Chat SDK channel', {
  platform: z.enum(['telegram', 'slack', 'teams', 'github', 'linear']),
  channel: z.string(),
  text: z.string(),
}, async ({ platform, channel, text }) => {
  await sendPlatformMessage(platform, channel, text);
  return { content: [{ type: 'text', text: `Message sent on ${platform}` }] };
});

server.tool('computer', 'Spawn an additional sandbox for isolated/heavy compute', {
  command: z.string(),
  isolated: z.boolean().default(false),
  persistent: z.boolean().default(false),
}, async ({ command, isolated, persistent }) => {
  const daytona = new Daytona();
  const sandbox = await daytona.create({
    volumes: isolated ? [] : [{ volumeId: AGENT_VOLUME_ID, mountPath: '/workspace' }],
    autoStopInterval: persistent ? 0 : 15,
    ephemeral: isolated,
  });
  const result = await sandbox.process.executeCommand(command);
  if (!persistent) await sandbox.stop();
  return { content: [{ type: 'text', text: result.output }] };
});

server.run({ transport: 'stdio' });
```

OpenCode config to register the MCP server:

```json
// .opencode/config.json (on volume)
{
  "mcp": {
    "dispatch": {
      "command": "node",
      "args": ["/opt/dispatch-mcp/index.js"],
      "env": {
        "BROWSERBASE_API_KEY": "...",
        "GMAIL_CREDENTIALS": "...",
        "DAYTONA_API_KEY": "..."
      }
    }
  }
}
```

### Option B: OpenCode Plugin (if plugin API supports it)

Use OpenCode's native plugin system to register tools directly. Same effect, less indirection.

---

## Sandbox Lifecycle Management

### Official Pattern: Daytona + OpenCode SDK

We follow the [official Daytona OpenCode SDK guide](https://www.daytona.io/docs/en/guides/opencode/opencode-sdk-agent/).
No custom Docker images. OpenCode is installed via npm at provisioning time and started via Daytona process sessions.

### Creating an Agent

```typescript
// lib/agents/create.ts

async function provisionAgent(config: AgentConfig) {
  const daytona = new Daytona();

  // 1. Create persistent volume (get-or-create, wait until ready)
  const volume = await daytona.volume.get(`agent-${config.userId}-${config.slug}`, true);
  // Poll until volume.state === "ready"

  // 2. Create sandbox with default image + volume
  const sandbox = await daytona.create({
    image: 'debian:12-slim',
    public: true,
    volumes: [{ volumeId: volume.id, mountPath: '/home/daytona/agent' }],
    resources: { cpu: 2, memory: 4, disk: 8 },
    envVars: {
      OPENCODE_SERVER_PASSWORD: serverPassword,
      OPENCODE_HOME: '/home/daytona/agent/.opencode',
      OPENAI_API_KEY: process.env.OPENROUTER_API_KEY,  // OpenRouter for multi-model
      OPENAI_API_BASE: 'https://openrouter.ai/api/v1',
    },
    autoStopInterval: 15,
  });

  // 3. Install OpenCode via npm (official method)
  await sandbox.process.executeCommand('npm i -g opencode-ai@1.1.1');

  // 4. Write AGENTS.md to volume
  await sandbox.fs.uploadFiles([...]);

  // 5. Inject config via OPENCODE_CONFIG_CONTENT env var and start server
  //    Uses process sessions (runAsync: true) so server persists
  const envVar = injectEnvVar('OPENCODE_CONFIG_CONTENT', JSON.stringify(opencodeConfig));
  await sandbox.process.createSession(sessionId);
  await sandbox.process.executeSessionCommand(sessionId, {
    command: `${envVar} opencode serve --port 4096 --hostname 0.0.0.0`,
    runAsync: true,
  });

  // 6. Wait for "opencode server listening" in stdout logs
  sandbox.process.getSessionCommandLogs(sessionId, cmdId, (stdout) => {
    if (stdout.includes('opencode server listening')) resolve();
  });

  // 7. Save sandboxId + volumeId in Convex
}
```

### Waking a Sandbox

```typescript
// lib/agents/ensure-running.ts

async function ensureAgentRunning(sandboxId: string): Promise<{ previewUrl: string }> {
  const daytona = new Daytona();
  const sandbox = await daytona.get(sandboxId);

  // Start sandbox if stopped
  if (sandbox.state !== 'started') {
    await daytona.start(sandbox, 60);
  }

  // Get preview URL for OpenCode HTTP API
  const preview = await sandbox.getPreviewLink(4096);

  // Check health; if OpenCode not running, restart via process session
  const healthy = await checkHealth(preview.url);
  if (!healthy) {
    await startOpenCodeServer(sandbox, opencodeConfig);
  }

  return { previewUrl: preview.url };
}
```

### No Custom Docker Image Needed

We follow Daytona's official pattern: use `debian:12-slim` base image, install OpenCode via `npm i -g opencode-ai` at provisioning time, and start the server via Daytona process sessions.

**Future optimization:** Use Daytona snapshots to pre-bake a sandbox with OpenCode installed for sub-second agent creation.

```typescript
// Create snapshot after first install
const snapshot = await sandbox.snapshot();
// Future agents: daytona.create({ snapshot: snapshot.id }) — instant startup
```

---

## Frontend

Same as before — Next.js App Router, chat UI, dashboard. But SIMPLER because OpenCode handles sessions natively.

### Chat Hook

```typescript
// hooks/useChat.ts

export function useChat(agentId: string) {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  async function send(text: string) {
    setStreaming(true);

    const res = await fetch(`/api/agents/${agentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId }),
    });

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const events = parseSSE(decoder.decode(value));

      for (const event of events) {
        // Update messages based on OpenCode events
        handleEvent(event, setMessages, setSessionId);
      }
    }

    setStreaming(false);
  }

  return { messages, send, streaming, sessionId };
}
```

---

## Chat SDK Layer

Single Chat SDK service (or Vercel route handlers) handles platform adapters and routes normalized threads/messages to agent sandboxes.

```typescript
// lib/bot/chat-sdk.ts

const bot = new Chat({
  adapters: {
    telegram: createTelegramAdapter(),
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
});

bot.onMessage(async ({ message, thread, platform, respond }) => {
  // 1. Find agent bound to this platform thread
  const integration = await convex.query(api.integrations.findByBinding, {
    binding: `${platform}:${thread.id}`,
  });
  if (!integration) return;

  // 2. Send to agent runtime
  const response = await fetch(`${API_URL}/api/agents/${integration.agentId}/chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BOT_API_KEY}` },
    body: JSON.stringify({
      message: message.text,
      sessionId: integration.persistentSessionId,
    }),
  });

  // 3. Collect response and send through the same platform adapter
  const fullText = await collectSSEText(response.body);
  await respond(fullText);
});
```

---

## Cost Model

### Per Agent

| State | Cost | What's running |
|-------|------|----------------|
| Idle (sandbox stopped) | ~$0/mo | Nothing. Volume storage is free on Daytona. |
| Active (sandbox running) | Daytona per-second billing | OpenCode server + MCP server |
| Light use (30min/day active) | ~$3-8/mo | LLM costs dominate |
| Heavy use (8h/day active) | ~$15-30/mo | Sandbox compute + LLM costs |
| Always-on | ~$30-50/mo | Persistent sandbox |

### Fixed Infrastructure

| Component | Cost |
|-----------|------|
| Vercel (Next.js) | ~$20/mo |
| Convex | ~$25-50/mo |
| Chat SDK service / adapter runtime | ~$0-10/mo depending on hosting model |
| Daytona (platform) | Per-usage (included in per-agent) |
| **Total** | **~$50-55/mo** |

---

## What We Build vs What We Use

| Concern | Build or Use | Details |
|---------|-------------|---------|
| Agent runtime harness (tool loop) | **USE** OpenCode | Server mode, SDK, sessions, compaction |
| Compute | **USE** Daytona | Sandboxes, volumes, lifecycle |
| Web browsing | **USE** Browserbase + Stagehand | MCP tool |
| LLM calls | **USE** OpenCode's provider system | Multi-provider built-in |
| Auth | **BUILD** | Better Auth + Google OAuth + Convex-backed user state |
| Frontend | **BUILD** | Next.js chat UI |
| Billing | **BUILD** | Stripe + credit tracking |
| External tools | **BUILD** | MCP server with our integrations |
| Multi-channel bot shell | **USE** Chat SDK | Unified adapters, threads, messages, streaming |
| Agent CRUD + pack management | **BUILD** | Vercel API + Convex |

**Our code: ~3,000-5,000 lines.** Everything else is existing infrastructure.

---

## Migration Path

### Phase 1: Core (Week 1-2)
- Next.js app scaffold
- Convex schema/functions
- Auth (Google OAuth)
- Agent CRUD → creates Daytona sandbox + volume + OpenCode server
- Chat endpoint → proxies to OpenCode SDK
- Basic frontend chat UI
- **Milestone: Create an agent, chat with it, and let it use bash + files**

### Phase 2: Tools + Billing (Week 3-4)
- MCP server with browser, email, calendar, computer tools
- Credit tracking middleware
- Stripe subscription integration
- Session management UI (list, switch, delete)
- **Milestone: An agent browses the web, sends emails, and costs are tracked**

### Phase 3: Messaging + Crons (Week 5)
- Chat SDK bootstrap + adapters (Telegram, Slack first)
- Persistent sessions for platform threads
- Cron system (Convex + Vercel cron)
- **Milestone: An agent works on Telegram + Slack and runs scheduled tasks**

### Phase 4: Teams + Polish (Week 6-7)
- Team CRUD + shared agents
- Workspace file browser UI
- Memory editor UI
- Agent packs / templates for vertical roles
- **Milestone: Teams can share agents, full UI**

---

## Open Questions

1. **Runtime adapter boundary**: Validate that Dispatch's product layer can stay cleanly separated from harness-specific concepts so OpenCode can ship first without blocking a later Pi adapter.

2. **OpenCode session persistence across sandbox restarts**: OpenCode stores sessions in SQLite. SQLite on a FUSE volume (Daytona) might be slow. Need to test. Alternative: keep raw sessions on volume and mirror only product-critical summaries into Convex.

3. **OpenCode event streaming for credit tracking**: Need to verify that OpenCode's SSE events include token usage data so we can deduct credits accurately.

4. **MCP server cold start in sandbox**: When sandbox wakes up, both OpenCode and MCP server need to start. Need to measure total cold start time.

5. **Daytona sandbox → Daytona sandbox networking**: For the "computer" tool (spawning additional sandboxes), need to verify that sandboxes can be created from within a sandbox via the Daytona API.

6. **OpenCode plugin system maturity**: Need to verify MCP server integration works reliably for our custom tools. Alternative: fork OpenCode and add tools directly.

7. **Pi as alternative to OpenCode**: Pi (pi-mono) is simpler, all-TypeScript, library-first. Could use a `PiRuntimeAdapter` instead of `OpenCodeRuntimeAdapter`. Trade-off: less features but more control. Worth prototyping both.
