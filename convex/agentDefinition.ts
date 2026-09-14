import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "./_generated/api";

/**
 * Base agent definition for Dispatch.
 *
 * This agent does NOT call LLMs directly — OpenCode (or other harnesses)
 * handles generation inside the sandbox. We use this purely for:
 * - Thread management (create, continue, list)
 * - Message persistence (save user messages, DeltaStreamer for assistant)
 * - Streaming delta storage
 *
 * `languageModel` is required by the Agent constructor but is never invoked.
 * Generation is handled externally by the harness. The DeltaStreamer pipes
 * external streams into Convex.
 */
export const baseAgent = new Agent(components.agent, {
  name: "Dispatch Agent",
  languageModel: openai("gpt-4o-mini"),
});
