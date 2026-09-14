# Reasoning Streaming — Design Doc (v2, research-verified)

**Date:** 2026-04-06
**Status:** Phase 1 in progress
**Goal:** Stream the model's chain-of-thought ("thinking") as a collapsible block inline with the assistant message, matching the v1 Jarvis pattern.

## Motivation

During 15-22s first-text latencies, users see only a static `Thinking…` shimmer. Showing the model's actual reasoning tokens as they stream turns dead waiting time into a transparency/trust win and gives users something to read during the gap.

## Revision note (v2)

v1 of this spec assumed all four layers (OpenCode, AI SDK chunks, assistant-ui converter, our route/UI) worked and the feature was purely additive UI work. **Deeper research revealed a blocker at the adapter layer that the type system hides.** This v2 reflects the verified pipeline state and reorganizes the work into a diagnostic-first phased rollout.

---

## Verified pipeline state (all sources cited)

### What works (confirmed)

- **OpenCode event shape**
  - `EventMessagePartUpdated` at `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:354-360`: `{ type: "message.part.updated", properties: { part: Part, delta?: string } }`
  - `ReasoningPart` is a first-class union member of `Part` at line 158: `{ type: "reasoning", text: string, time: { start, end? } }`
  - Same event stream as text/tool parts — no separate reasoning events
  - `delta` is **optional** — some emissions may carry only accumulated `part.text`

- **OpenCode provider capability flag**
  - `ProviderConfig.models[].reasoning?: boolean` exists at `types.gen.d.ts:890`
  - `Model.capabilities.reasoning: boolean` exists at `types.gen.d.ts:1289`
  - Capability is **declared in provider config** — no per-request flag, no `reasoning` field in `SessionPromptData.body`
  - Confirms: enabling reasoning is config-level, automatic once declared

- **AI SDK wire protocol**
  - Has `reasoning-start`, `reasoning-delta`, `reasoning-end` chunks as first-class types in `node_modules/ai/docs/04-ai-sdk-ui/50-stream-protocol.mdx`

- **assistant-ui conversion**
  - `@assistant-ui/react-ai-sdk/src/ui/utils/convertMessage.ts:140-144` maps reasoning parts straight to `ReasoningMessagePart` automatically
  - `@assistant-ui/core/src/types/message.ts:17-21` defines `ReasoningMessagePart` in the part union
  - **No converter changes needed**

### What's broken (confirmed)

- **Our chat route handler** — `app/api/agents/[id]/chat/route.ts:308-317` has a buggy stub:
  - Writes `reasoning-start` + `reasoning-delta` + `reasoning-end` on **every delta** — creates a fresh reasoning block per token
  - Only handles `if (delta)` — drops reasoning if delta is undefined but `part.text` carries accumulated content
  - Comment says "Not commonly emitted by OpenCode" — suggests it's never actually fired in practice

- **Our model map** — `lib/models.ts:83-89` emits `{ name }` per model, no `reasoning: true` flag. OpenCode has no way to know which models support reasoning.

- **Our UI renderer** — `components/assistant-ui/thread.tsx:174-183` only handles `text` and `tool-call` parts, explicit `return null` for everything else including reasoning. **Reasoning parts would reach the renderer and disappear.**

### What's uncertain (not verifiable without live test)

- **Does `@ai-sdk/openai-compatible` actually emit reasoning events for our current models?**
  - Package runs inside the Daytona sandbox at runtime, not installed locally, so source can't be inspected from dev
  - AI SDK docs say it supports reasoning "for models that return reasoning/thinking tokens (e.g., DeepSeek R1)" — implies support is **model-specific and field-name-dependent**

---

## The critical finding — adapter-level incompatibility

Per OpenRouter docs + Moonshot K2.5 docs + Vercel AI SDK docs + relevant GitHub issues (`vercel/ai#11682`, `ollama/ollama#15368`, `lemonade-sdk/lemonade#1370`):

| Model | Field emitted in streaming | Parsed by `@ai-sdk/openai-compatible`? |
|---|---|---|
| **Kimi K2.5** | `choices[].delta.reasoning_content` (Moonshot-native, uses `thinking: { type: "enabled" }` param) | ❌ Non-standard field, likely silently dropped |
| **DeepSeek R1** | Inline `<think>...</think>` tags embedded in `content` | ✅ Works — content comes through standard field |
| **Claude Sonnet/Opus 4.6** (via OpenRouter) | `choices[].delta.reasoning_details` (OpenRouter's unified format) | ⚠️ Unknown — similar non-standard field, may have same issue |
| **GPT-5.4** (via OpenRouter openai-compat) | OpenRouter wraps OpenAI's native reasoning stream parts | ⚠️ Unknown — depends on adapter's GPT-5 awareness |
| **Gemini 3.1 Pro** | `reasoning_details` | ⚠️ Unknown |

**The killer insight:** The pipeline's types all line up perfectly, but there's a specific npm package (`@ai-sdk/openai-compatible`) in the middle that was designed around OpenAI's standard streaming response format. Models emitting reasoning in provider-specific fields (Kimi's `reasoning_content`, OpenRouter's `reasoning_details`) may be **silently dropped** before reaching OpenCode's event bus.

**We cannot verify this without running live code** — the adapter source isn't in our local `node_modules`.

**User guidance for this spec:** If Kimi K2.5 specifically doesn't support reasoning through this stack, we are permitted to default to a different model for reasoning visibility. Kimi K2.5 stays as the `tier: "default"` choice for general chat; a separate `tier: "premium"` reasoning model can be the recommendation when users want to see thinking.

---

## Phased rollout

### Phase 1 — Diagnostic (ship first, one commit)

**Goal:** Definitively answer "does OpenCode emit reasoning events for any of our current models?" before writing UI code.

**Changes:**

1. **`lib/models.ts`** — add capability flag to `ModelDefinition`:
   ```ts
   interface ModelDefinition {
     ...
     reasoning?: boolean;
   }
   ```
   Flag multiple candidates (not just Kimi) to get broad signal from one test cycle:
   - `moonshotai/kimi-k2.5` → `reasoning: true` (current default — want to know)
   - `anthropic/claude-sonnet-4.6` → `reasoning: true` (premium candidate)
   - `anthropic/claude-opus-4.6` → `reasoning: true` (premium candidate)
   - `google/gemini-3.1-pro-preview` → `reasoning: true` (premium candidate)
   - `openai/gpt-5.4` → `reasoning: true` (premium candidate)

2. **`lib/models.ts`** — update `getOpenCodeModelMap()` to propagate the flag:
   ```ts
   export function getOpenCodeModelMap(): Record<string, { name: string; reasoning?: boolean }> {
     const map: Record<string, { name: string; reasoning?: boolean }> = {};
     for (const m of MODELS) {
       map[m.id] = { name: m.label, ...(m.reasoning && { reasoning: true }) };
     }
     return map;
   }
   ```
   The `reasoning: true` flag propagates through `buildOpenCodeConfig` in `lib/agents/ensure-running.ts` into OpenCode's provider config automatically — no changes to that file needed.

3. **`app/api/agents/[id]/chat/route.ts`** — add a diagnostic log at the top of the stream loop:
   ```ts
   // DIAGNOSTIC — remove after Phase 2 ships
   if (event.type === "message.part.updated") {
     const p = (event as any).properties?.part;
     if (p?.type === "reasoning") {
       perfLog("chat.reasoning.event", {
         hasDelta: !!(event as any).properties?.delta,
         textLen: p.text?.length ?? 0,
         partId: p.id?.slice(0, 8),
       });
     }
   }
   ```
   This fires on **every** reasoning event, tells us whether events are flowing, whether they carry `delta` or accumulated `text`, and how long the content is.

**No UI changes, no route handler fixes in this phase.** The buggy `case "reasoning"` stub stays as-is — it's harmless because it doesn't fire if no events arrive.

**Risks:** Zero. All changes are additive. No user-facing behavior change.

### Phase 1 test protocol

After Phase 1 deploys:

1. Open chat with a Kimi K2.5 agent → send any message → check Vercel function logs for `[perf] chat.reasoning.event` lines
2. **If any** appear for Kimi → Phase 2 proceeds with Kimi as default
3. **If none** appear for Kimi → restart the agent (new sandbox picks up updated config) → test again
4. **If still none** for Kimi → switch the agent's model to Claude Sonnet 4.6 via UI → test → repeat for Opus, Gemini, GPT-5.4
5. Log the first model that produces events → that becomes the "reasoning default" for Phase 2

### Phase 1 decision tree

| Phase 1 outcome | Phase 2 action |
|---|---|
| **Kimi K2.5 emits reasoning events** | Ship Phase 2 as-is — Kimi is the default, reasoning works out of the box |
| **Kimi doesn't, but Claude/Gemini/GPT-5.4 do** | Ship Phase 2 + mark the working model as `reasoningDefault: true` in model registry. UI can opt-in suggest it. |
| **No models emit reasoning events** | Pipeline is broken upstream (adapter or OpenCode). **Do not ship Phase 2.** Open a separate investigation: swap `@ai-sdk/openai-compatible` for a different provider adapter in `buildOpenCodeConfig`. |

### Phase 2 — Implementation (conditional on Phase 1 result)

**Only ship if Phase 1 test confirms reasoning events flow.**

1. **`app/api/agents/[id]/chat/route.ts`** — rewrite the `case "reasoning"` handler with proper dedup logic, mirroring the text path at lines 183-214:
   - Track `sentReasoningContents` map (accumulated-vs-incremental detection)
   - Track `openReasoningParts` set (write `reasoning-start` once per part)
   - Handle both `delta`-mode and `part.text`-only mode (whichever Phase 1 reveals is reality)
   - Close any still-open reasoning parts in the post-loop cleanup block

2. **`components/assistant-ui/thread.tsx`** — add `ReasoningBlock` renderer:
   ```tsx
   function ReasoningBlock({ text }: { text: string }) {
     const [expanded, setExpanded] = useState(true);
     return (
       <div className="mb-3 mt-2 border-l-2 border-muted-foreground/20 pl-3">
         <button
           type="button"
           onClick={() => setExpanded((v) => !v)}
           className="flex items-center gap-1 text-xs text-muted-foreground/70 transition-colors hover:text-muted-foreground"
         >
           <span>Thinking</span>
           {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
         </button>
         {expanded && text && (
           <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/80">
             {text}
           </div>
         )}
       </div>
     );
   }
   ```

3. Wire into `MessagePrimitive.Parts`:
   ```tsx
   if (part.type === "reasoning") return <ReasoningBlock text={part.text} />;
   ```

4. **Remove Phase 1 diagnostic log** (or leave behind a gate to enable it via env).

5. Ship as one commit.

### Phase 3 — Polish (optional, after Phase 2)

1. **Dedupe the shimmer** — once reasoning streams, the existing `<p className="shimmer">Thinking…</p>` at `thread.tsx:174` becomes redundant during the thinking phase. Gate it so it only shows before any reasoning or text part exists.
2. **Expand `reasoning: true` flag** to any other model the user enables once confirmed.
3. **Per-model UI hint** — if a user sends a message to a non-reasoning model, don't even wait for a reasoning block.

---

## Summary

- **Phase 1 = diagnostic** (~15 LOC, zero risk, zero UI change)
- **Phase 2 = UI implementation** (only if Phase 1 proves the pipeline works)
- **Phase 3 = polish** (only if Phase 2 ships cleanly)

The reason for phasing: the original spec would have shipped a renderer that does nothing if Kimi K2.5's reasoning doesn't flow through `@ai-sdk/openai-compatible`. Phase 1 is the cheapest way to avoid that outcome.
