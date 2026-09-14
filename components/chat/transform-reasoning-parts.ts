import type { UIMessage } from "ai";

type ReasoningPart = {
  type?: string;
  text?: string;
  content?: string;
  state?: string;
};

/**
 * agent-elements' MessageList silently drops bare `reasoning` parts —
 * the renderer only handles text, error, and `tool-*` parts. To keep
 * reasoning visible (live and from history) we rewrite each
 * reasoning part as a synthetic `tool-Thinking` part so the registry's
 * `ThinkingTool` renders it as a "Thinking" card with an expandable
 * thought body.
 *
 * Streaming-friendly: a reasoning part still accumulating text gets
 * `state: "input-streaming"` so ThinkingTool shows the live shimmer;
 * a `state: "done"` part becomes `output-available` ("Thought").
 */
export function transformReasoningParts(messages: UIMessage[]): UIMessage[] {
  let mutated = false;
  const next = messages.map((msg) => {
    if (!Array.isArray(msg.parts)) return msg;
    let messageMutated = false;

    const parts = msg.parts.map((p, i) => {
      const part = p as ReasoningPart;
      if (part?.type !== "reasoning") return part;
      const text =
        typeof part.text === "string"
          ? part.text
          : typeof part.content === "string"
            ? part.content
            : "";
      if (!text) return null;
      messageMutated = true;
      const isStreaming = part.state === "streaming";
      return {
        type: "tool-Thinking",
        toolCallId: `${msg.id}-thinking-${i}`,
        state: isStreaming ? "input-streaming" : "output-available",
        title: "Thinking",
        input: { thought: text },
      };
    });

    if (!messageMutated) return msg;
    mutated = true;
    return {
      ...msg,
      parts: parts.filter(Boolean) as UIMessage["parts"],
    };
  });

  return mutated ? next : messages;
}
