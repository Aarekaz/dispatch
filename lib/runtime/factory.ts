import type { AgentRuntimeAdapter } from "@/lib/runtime";
import { OpenCodeRuntimeAdapter } from "./opencode";

/**
 * Creates a runtime adapter for connecting to an agent's OpenCode server.
 * Uses the official @opencode-ai/sdk client.
 */
export function createRuntimeAdapter(
  previewUrl: string,
  serverPassword: string,
): AgentRuntimeAdapter {
  return new OpenCodeRuntimeAdapter(previewUrl, serverPassword);
}
