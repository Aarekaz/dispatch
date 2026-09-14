import type { UIMessageStreamWriter } from "ai";

import type { ClassifiedError } from "@/lib/chat/errors";
import { classifyRuntimeError } from "@/lib/chat/errors";
import type { RuntimeEvent, RuntimeUsage } from "@/lib/runtime";
import {
  HIDDEN_TOOLS,
  enrichArgsWithPath,
  resolveToolName,
  resolveToolType,
} from "@/lib/tools/normalize";
import {
  adaptOpenCodeToolInput,
  adaptOpenCodeToolOutput,
} from "@/lib/tools/adapters/opencode-to-agent-elements";

// Bumped from the assistant-ui era's 500 chars: agent-elements'
// SearchTool / Glob / Grep render line-keyed lists and benefit from a
// fuller body. 8 KB is still small enough to keep the wire happy.
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n... (truncated)" : s;
}

/**
 * Bridge: RuntimeEvent → AI SDK UI message stream protocol.
 *
 * This is the consumer-side of the runtime adapter for the web sandbox.
 * The chat API route hands us its `writer` (from `createUIMessageStream`)
 * and an iterable of `RuntimeEvent`s; we translate each event into the
 * appropriate `text-start`/`text-delta`/`tool-input-available`/etc.
 * messages that assistant-ui understands on the client.
 *
 * Display normalization (HIDDEN_TOOLS filtering, friendly tool names,
 * file-path enrichment) happens here — NOT in the runtime adapter —
 * because these are UI concerns that don't apply to other surfaces
 * like Chat SDK platform handlers.
 *
 * Returns aggregated metrics so the caller can log them and persist
 * the final assistant text to Convex.
 */
export async function toUIMessageStream(
  events: AsyncIterable<RuntimeEvent>,
  writer: UIMessageWriter,
  marks?: BridgeMarks,
): Promise<BridgeResult> {
  let fullAssistantText = "";
  let usage: RuntimeUsage | undefined = undefined;
  let classifiedError: ClassifiedError | undefined = undefined;

  // ── Text part state ──
  // Text parts have a start/delta+/end lifecycle. We track the
  // currently-open text part so we can close it before emitting a
  // tool call (assistant-ui expects strict ordering: text, then tool,
  // then text, ...).
  let textPartId: string | null = null;
  // Map opencode part.id → our local text-part id, so multiple
  // distinct text parts within a single turn each get their own
  // text-start/text-end pair.
  const textPartIdByLocal = new Map<string, string>();

  // ── Reasoning part state ──
  const openReasoningParts = new Set<string>();
  let reasoningCounter = 0;

  // ── Tool state ──
  // Set of toolCallIds we've already filtered out (HIDDEN_TOOLS) so
  // we can ignore their later events without re-checking the name.
  const hiddenToolCallIds = new Set<string>();
  // Set of toolCallIds we've emitted tool-input-start for (so we
  // don't double-emit).
  const startedToolCallIds = new Set<string>();
  let toolCount = 0;

  // Perf marks
  let firstTextMarked = false;
  let firstToolMarked = false;

  // Helper: close any currently-open text part. Called before emitting
  // a tool call, since assistant-ui requires strict text→tool ordering.
  const closeOpenTextPart = () => {
    if (textPartId) {
      writer.write({ type: "text-end", id: textPartId });
      textPartId = null;
    }
  };

  for await (const event of events) {
    switch (event.type) {
      case "message.delta": {
        if (!event.value) break;
        if (!firstTextMarked) {
          firstTextMarked = true;
          marks?.onFirstText?.();
        }
        // Open a text part on first delta (or after a tool call closed
        // the previous one). assistant-ui needs a fresh id for each
        // text segment between tool calls.
        if (!textPartId) {
          textPartId = `text-${textPartIdByLocal.size + 1}`;
          textPartIdByLocal.set(textPartId, textPartId);
          writer.write({ type: "text-start", id: textPartId });
        }
        writer.write({
          type: "text-delta",
          id: textPartId,
          delta: event.value,
        });
        fullAssistantText += event.value;
        break;
      }

      case "reasoning.delta": {
        if (!event.value) break;
        // Each reasoning sequence opens its own part. We open one
        // when we see a delta and close it on the next non-reasoning
        // event (or at run end). For simplicity, we keep one open
        // reasoning id at a time and re-open if needed.
        let rid: string;
        if (openReasoningParts.size === 0) {
          rid = `reasoning-${++reasoningCounter}`;
          openReasoningParts.add(rid);
          writer.write({ type: "reasoning-start", id: rid });
        } else {
          // Reuse the most recently opened reasoning part.
          rid = Array.from(openReasoningParts).at(-1) as string;
        }
        writer.write({ type: "reasoning-delta", id: rid, delta: event.value });
        break;
      }

      case "tool.started": {
        // HIDDEN_TOOLS filter — drop entirely. assistant-ui never sees them.
        if (HIDDEN_TOOLS.has(event.toolName)) {
          hiddenToolCallIds.add(event.toolCallId);
          break;
        }
        if (startedToolCallIds.has(event.toolCallId)) break;
        startedToolCallIds.add(event.toolCallId);

        // Two names per tool:
        //   - `registryType` is what agent-elements dispatches on
        //     (`tool-${type}` ⇒ specialized renderer or registry
        //     fallback). MUST be a valid identifier — no spaces.
        //   - `displayTitle` is the friendly label we want surfaced
        //     in the rendered card / Slack task / Plan task.
        const registryType = resolveToolType(event.toolName);
        const displayTitle = resolveToolName(event.toolName, event.title);
        if (!firstToolMarked) {
          firstToolMarked = true;
          marks?.onFirstTool?.(displayTitle);
        }

        // Tool calls must come AFTER any open text part is closed,
        // and AFTER any open reasoning parts.
        closeOpenTextPart();
        for (const rid of openReasoningParts) {
          writer.write({ type: "reasoning-end", id: rid });
        }
        openReasoningParts.clear();

        // `dynamic: false` lands on the client as a typed
        // `tool-${registryType}` part rather than `dynamic-tool` —
        // that's what the agent-elements switch dispatches on.
        // The friendly display name rides along on the `title`
        // field which the AI SDK propagates through to the part.
        writer.write({
          type: "tool-input-start",
          toolCallId: event.toolCallId,
          toolName: registryType,
          title: displayTitle,
          dynamic: false,
        });

        // Only emit input deltas when we have meaningful content. The
        // route used to JSON.stringify(input) for an inputTextDelta —
        // we keep that behavior for back-compat with the existing UI.
        // Adapter alias-renames OpenCode's camelCase to Claude-SDK
        // snake_case so the agent-elements registry's `extractToolDetail`
        // sees the fields it expects (file_path, old_string, …).
        const adaptedStartedInput = adaptOpenCodeToolInput(
          event.toolName,
          event.input,
        );
        if (Object.keys(adaptedStartedInput).length > 0) {
          writer.write({
            type: "tool-input-delta",
            toolCallId: event.toolCallId,
            inputTextDelta: JSON.stringify(adaptedStartedInput, null, 2),
          });
        }
        break;
      }

      case "tool.completed": {
        if (hiddenToolCallIds.has(event.toolCallId)) break;

        const registryType = resolveToolType(event.toolName);
        const displayTitle = resolveToolName(event.toolName, event.title);

        // Defensive: emit a synthesized started if we somehow missed
        // it. The runtime adapter already does this, but a stale
        // upstream could still produce orphaned completions.
        if (!startedToolCallIds.has(event.toolCallId)) {
          startedToolCallIds.add(event.toolCallId);
          closeOpenTextPart();
          writer.write({
            type: "tool-input-start",
            toolCallId: event.toolCallId,
            toolName: registryType,
            title: displayTitle,
            dynamic: false,
          });
        }
        // The final tool-input-available MUST carry the same structured
        // input that was streamed via tool-input-delta on tool.started.
        // If we sent the fallback `{ tool: rawToolName }` here the AI
        // SDK client would see the args go from real → generic and
        // rewrite the snapshot, breaking partial-stream display.
        const enrichedInput = enrichArgsWithPath(
          (event.input as Record<string, unknown> | undefined) ?? {},
          event.title,
          event.output,
        );
        // Apply the OpenCode → Claude Agent SDK alias map BEFORE the
        // input lands on the wire, so agent-elements' renderers see
        // file_path / old_string / new_string / query and dispatch
        // properly. Originals are preserved by the adapter for the
        // "Show request / response" debug panel.
        const adaptedInput = adaptOpenCodeToolInput(
          event.toolName,
          enrichedInput,
        );
        const hasInput = Object.keys(adaptedInput).length > 0;
        writer.write({
          type: "tool-input-available",
          toolCallId: event.toolCallId,
          toolName: registryType,
          title: displayTitle,
          input: hasInput ? adaptedInput : { tool: event.toolName },
          dynamic: false,
        });

        // Reshape the output to what each agent-elements renderer
        // reads (Edit ↦ structuredPatch, Grep/Glob ↦ { numFiles },
        // WebFetch ↦ { results }, …). Pass through OpenCode's
        // metadata (diff, exitCode) so the adapter has the source
        // material it needs.
        const reshapedOutput = adaptOpenCodeToolOutput(
          event.toolName,
          adaptedInput,
          truncate(event.output ?? "", 8_000),
          event.metadata,
        );
        writer.write({
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          output: reshapedOutput,
          dynamic: false,
        });
        toolCount++;
        break;
      }

      case "tool.error": {
        if (hiddenToolCallIds.has(event.toolCallId)) break;
        writer.write({
          type: "tool-output-error",
          toolCallId: event.toolCallId,
          errorText: event.error,
          dynamic: false,
        });
        toolCount++;
        break;
      }

      case "run.completed": {
        usage = event.usage;
        break;
      }

      case "run.error": {
        // Classify the raw error through the same pipeline as the
        // Chat SDK bridge so web chat and Slack show the same clean,
        // branded message. See `lib/chat/errors.ts`.
        const classified = classifyRuntimeError(
          event.error,
          event.errorDetail ?? event.error,
          marks?.agentName ?? "Your agent",
        );
        classifiedError = classified;
        marks?.onClassified?.(classified);
        const errorId = `error-${Date.now()}`;
        closeOpenTextPart();
        writer.write({ type: "text-start", id: errorId });
        writer.write({
          type: "text-delta",
          id: errorId,
          delta: classified.userMessage,
        });
        writer.write({ type: "text-end", id: errorId });
        break;
      }

      case "status":
        // No-op for the AI SDK bridge — status events are informational.
        break;
    }
  }

  // Close any still-open parts at end of stream.
  closeOpenTextPart();
  for (const rid of openReasoningParts) {
    writer.write({ type: "reasoning-end", id: rid });
  }
  openReasoningParts.clear();

  return { fullAssistantText, toolCount, usage, error: classifiedError };
}

// ── Types ────────────────────────────────────────────────────

/**
 * The AI SDK writer type, re-exported under a local alias so callers
 * of this bridge don't have to know which package the type lives in.
 *
 * The bridge is intentionally coupled to AI SDK protocol types — its
 * entire job is translating `RuntimeEvent`s into AI SDK chunks — so
 * importing the real writer here is correct, not a leak.
 */
export type UIMessageWriter = UIMessageStreamWriter;

export type BridgeMarks = {
  /** Agent display name — used to produce classified error messages
   *  that match what Slack shows. Falls back to "Your agent" if absent. */
  agentName?: string;
  /** Called once when the first text delta arrives. */
  onFirstText?: () => void;
  /** Called once when the first tool call starts. */
  onFirstTool?: (toolName: string) => void;
  /** Called once if the stream contains a `run.error`. Same pattern as
   *  the Chat SDK bridge — lets the chat route persist the failure with
   *  the same classified error (same correlation ID) the user saw. */
  onClassified?: (classified: ClassifiedError) => void;
};

export type BridgeResult = {
  /** Concatenation of all `message.delta` values, ready to persist. */
  fullAssistantText: string;
  /** Number of tool calls completed (including errors), excluding HIDDEN_TOOLS. */
  toolCount: number;
  /** Final usage metrics from `run.completed`, if the run terminated normally. */
  usage?: RuntimeUsage;
  /** Set when the stream contained a `run.error`. The chat route uses
   *  this to log the run as "failed" instead of "completed". */
  error?: ClassifiedError;
};
