"use node";

import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { HarnessAdapter, HarnessEvent } from "./adapter";

const HIDDEN_TOOLS = new Set(["todoread", "todoclear"]);
const TOOL_LABELS: Record<string, string> = {
  bash: "Terminal",
  write: "Write File",
  edit: "Edit File",
  read: "Read File",
  glob: "Search Files",
  grep: "Search Content",
  fetch: "Web Fetch",
  browser: "Browser",
  todowrite: "Task Progress",
};

type HarnessEventEnvelope = HarnessEvent & {
  properties?: {
    info?: { id?: string; role?: string };
    error?: { message?: string } | string;
    part?: {
      type?: string;
      id?: string;
      callID?: string;
      messageID?: string;
      tool?: string;
      state?: {
        status?: string;
        title?: string;
        input?: Record<string, unknown>;
        output?: string;
        error?: string;
      };
    };
    delta?: string;
  };
};

export class OpenCodeAdapter implements HarnessAdapter {
  private client;

  constructor(private baseUrl: string) {
    this.client = createOpencodeClient({ baseUrl });
  }

  async createSession(): Promise<{ sessionId: string }> {
    const res = await this.client.session.create({ body: {} });
    if (res.error || !res.data?.id) {
      throw new Error(
        `Failed to create OpenCode session: ${res.error ?? "no id"}`,
      );
    }
    return { sessionId: res.data.id };
  }

  async sendAndSubscribe(
    sessionId: string,
    message: string,
  ): Promise<{ events: AsyncIterable<HarnessEvent> }> {
    // Subscribe to events BEFORE sending prompt (so we don't miss any)
    const eventResult = await this.client.event.subscribe();

    // Send prompt (non-blocking — we read events from the subscription)
    const promptPromise = this.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: message }] },
    });

    // Track prompt errors
    let promptError: Error | null = null;
    promptPromise.catch((err: Error) => {
      promptError = err;
    });

    const stream = eventResult.stream;

    async function* eventGenerator(): AsyncIterable<HarnessEvent> {
      for await (const event of stream) {
        yield event as HarnessEvent;

        // Stop on session.idle (primary exit signal)
        if (event.type === "session.idle") break;

        // Stop on session.error
        if (event.type === "session.error") break;
      }

      // If prompt errored in background, yield a synthetic error event
      if (promptError) {
        yield {
          type: "session.error",
          properties: { error: { message: promptError.message } },
        };
      }
    }

    return { events: eventGenerator() };
  }

  normalizeToUIStream(
    events: AsyncIterable<HarnessEvent>,
  ): ReadableStream<unknown> {
    let assistantMessageId: string | null = null;
    let textPartId: string | null = null;
    const seenToolStates = new Map<string, string>();

    return new ReadableStream({
      async pull(controller) {
        for await (const event of events) {
          const envelope = event as HarnessEventEnvelope;
          // Track assistant message ID
          if (event.type === "message.updated") {
            const msg = envelope.properties?.info;
            if (msg?.role === "assistant") {
              assistantMessageId = msg.id ?? null;
            }
            continue;
          }

          // Handle errors
          if (event.type === "session.error") {
            const errProps = envelope.properties;
            const errorMsg =
              (typeof errProps?.error === "object"
                ? errProps.error?.message
                : undefined) ??
              String(errProps?.error ?? "Session error");
            const errorId = `error-${Date.now()}`;
            controller.enqueue({ type: "text-start", id: errorId });
            controller.enqueue({
              type: "text-delta",
              id: errorId,
              delta: `Error: ${errorMsg}`,
            });
            controller.enqueue({ type: "text-end", id: errorId });
            controller.close();
            return;
          }

          // session.idle = stream complete
          if (event.type === "session.idle") {
            if (textPartId) {
              controller.enqueue({ type: "text-end", id: textPartId });
              textPartId = null;
            }
            for (const [toolCallId, status] of seenToolStates) {
              if (status === "running") {
                controller.enqueue({
                  type: "tool-output-available",
                  toolCallId,
                  output: "",
                });
              }
            }
            controller.close();
            return;
          }

          if (event.type !== "message.part.updated") continue;

          const { part, delta } = envelope.properties ?? {};
          if (
            !part ||
            !assistantMessageId ||
            part.messageID !== assistantMessageId
          ) {
            continue;
          }

          switch (part.type) {
            case "text": {
              if (delta) {
                if (!textPartId) {
                  textPartId = `text-${part.id ?? Date.now()}`;
                  controller.enqueue({ type: "text-start", id: textPartId });
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta,
                });
              }
              break;
            }

            case "tool": {
              const toolCallId = part.callID ?? part.id ?? "tool-call";
              const rawToolName = part.tool ?? "unknown";
              const state = part.state;

              if (HIDDEN_TOOLS.has(rawToolName)) break;

              const toolName = TOOL_LABELS[rawToolName] ?? rawToolName;
              const prevStatus = seenToolStates.get(toolCallId);

              if (state?.status === "running" && prevStatus !== "running") {
                if (textPartId) {
                  controller.enqueue({ type: "text-end", id: textPartId });
                  textPartId = null;
                }
                seenToolStates.set(toolCallId, "running");
                const displayTitle = state.title || toolName;
                controller.enqueue({
                  type: "tool-input-start",
                  toolCallId,
                  toolName: displayTitle,
                  title: displayTitle,
                });
                if (state.input) {
                  controller.enqueue({
                    type: "tool-input-delta",
                    toolCallId,
                    inputTextDelta: JSON.stringify(state.input, null, 2),
                  });
                }
              }

              if (
                state?.status === "completed" &&
                prevStatus !== "completed"
              ) {
                seenToolStates.set(toolCallId, "completed");
                const displayTitle = state.title || toolName;
                if (!prevStatus) {
                  if (textPartId) {
                    controller.enqueue({ type: "text-end", id: textPartId });
                    textPartId = null;
                  }
                  controller.enqueue({
                    type: "tool-input-start",
                    toolCallId,
                    toolName: displayTitle,
                    title: displayTitle,
                  });
                }
                controller.enqueue({
                  type: "tool-input-available",
                  toolCallId,
                  toolName: displayTitle,
                  input: state.input ?? {},
                  title: displayTitle,
                });
                const output = state.output ?? "";
                const truncatedOutput =
                  output.length > 500
                    ? output.slice(0, 500) + "\n... (truncated)"
                    : output;
                controller.enqueue({
                  type: "tool-output-available",
                  toolCallId,
                  output: truncatedOutput,
                });
              }

              if (state?.status === "error" && prevStatus !== "error") {
                seenToolStates.set(toolCallId, "error");
                controller.enqueue({
                  type: "tool-output-error",
                  toolCallId,
                  errorText: state.error ?? "Tool error",
                });
              }
              break;
            }

            case "reasoning": {
              if (delta) {
                const rid = `reasoning-${part.id ?? Date.now()}`;
                controller.enqueue({ type: "reasoning-start", id: rid });
                controller.enqueue({ type: "reasoning-delta", id: rid, delta });
                controller.enqueue({ type: "reasoning-end", id: rid });
              }
              break;
            }

            default:
              break;
          }
        }

        // Safety: close any open text part if we exit loop without session.idle
        if (textPartId) {
          controller.enqueue({ type: "text-end", id: textPartId });
        }
        controller.close();
      },
    });
  }
}
