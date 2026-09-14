/**
 * Background memory extraction — post-session reflection.
 *
 * After each chat turn, a small/fast model (Haiku) scans the
 * conversation for facts worth remembering. If it finds anything,
 * it appends to MEMORY.md on the sandbox and syncs to Convex.
 *
 * Pattern reference: Claude Code's extractMemories.ts (background
 * agent that updates MEMORY.md after turns). Also inspired by
 * Letta's "sleep-time agents."
 *
 * Fire-and-forget — never blocks the user's response.
 */
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});
import { readMemoryFile, writeMemoryFile } from "./memory";
import { trySyncAgentMemory } from "./memory-sync";

const EXTRACTION_TIMEOUT_MS = 5000;

const extractionSchema = z.object({
  facts: z.array(
    z.object({
      text: z.string().max(200),
      category: z.enum(["preference", "team", "integration", "process", "other"]),
    }),
  ),
  shouldSave: z.boolean(),
});

/**
 * Extract memories from the agent's last response.
 * Returns the number of facts extracted, or 0 if nothing was worth saving.
 */
export async function extractMemories(params: {
  agentId: string;
  sandboxId: string;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  agentName: string;
}): Promise<number> {
  const { userMessage, assistantResponse, agentName, sandboxId } = params;

  // Skip short/empty responses — nothing to extract
  if (assistantResponse.length < 100) return 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const { text: rawOutput } = await generateText({
      model: openrouter("anthropic/claude-haiku-4.5"),
      system: buildExtractionPrompt(agentName),
      prompt: `User: ${userMessage.slice(0, 500)}\n\nAssistant: ${assistantResponse.slice(0, 2000)}`,
      maxOutputTokens: 300,
      abortSignal: controller.signal,
    });

    clearTimeout(timeout);

    // Parse JSON from the response
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`[memory-extract] no_json agentId=${params.agentId.slice(-8)}`);
      return 0;
    }

    const parsed = extractionSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success || !parsed.data.shouldSave || parsed.data.facts.length === 0) {
      console.log(`[memory-extract] skip agentId=${params.agentId.slice(-8)} shouldSave=${parsed.data?.shouldSave ?? false}`);
      return 0;
    }

    // Read current MEMORY.md
    let currentMemory = "";
    try {
      currentMemory = await readMemoryFile(sandboxId, "/home/daytona/agent/memories/MEMORY.md");
    } catch {
      // File doesn't exist yet — we'll create it
    }

    // Append extracted facts
    const newEntries = parsed.data.facts
      .map((f) => `- ${f.text}`)
      .join("\n");

    const timestamp = new Date().toISOString().split("T")[0];
    const appendBlock = `\n\n## Auto-extracted (${timestamp})\n${newEntries}`;

    const updatedMemory = currentMemory
      ? currentMemory + appendBlock
      : `# Memory\n\n${agentName}'s persistent memory.\n${appendBlock}`;

    // Write back to sandbox
    await writeMemoryFile(sandboxId, "/home/daytona/agent/memories/MEMORY.md", updatedMemory);

    // Trigger background sync to Convex
    trySyncAgentMemory(params.agentId, sandboxId);

    console.log(
      `[memory-extract] saved agentId=${params.agentId.slice(-8)} facts=${parsed.data.facts.length} sessionId=${params.sessionId.slice(-8)}`,
    );

    return parsed.data.facts.length;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.log(`[memory-extract] timeout agentId=${params.agentId.slice(-8)}`);
    } else {
      console.warn(`[memory-extract] error agentId=${params.agentId.slice(-8)}`, err);
    }
    return 0;
  }
}

/**
 * Fire-and-forget wrapper. Never throws, never blocks.
 */
export function tryExtractMemories(params: {
  agentId: string;
  sandboxId: string;
  sessionId: string;
  userMessage: string;
  assistantResponse: string;
  agentName: string;
}): void {
  extractMemories(params).catch((err) => {
    console.warn("[memory-extract] background extraction failed:", err);
  });
}

function buildExtractionPrompt(agentName: string): string {
  return `You are a memory extraction system for ${agentName}, an AI agent.

Your job: scan a conversation turn and extract ONLY facts worth remembering long-term.

EXTRACT these types of facts:
- User preferences (formatting, tone, language, communication style)
- Team/company info (tools, processes, team members, org structure)
- Integration details (connected services, account names, workspace IDs)
- Process decisions (how they want things done, recurring patterns)
- Project context (deadlines, goals, stakeholders)

DO NOT EXTRACT:
- Generic knowledge (things any AI would know)
- Temporary/one-off requests ("send this email")
- Information already in the conversation context
- Opinions or subjective assessments

Respond with JSON only:
{
  "shouldSave": true/false,
  "facts": [
    { "text": "concise fact statement", "category": "preference|team|integration|process|other" }
  ]
}

If nothing is worth saving, return { "shouldSave": false, "facts": [] }.
Be very selective — only save what would be useful in FUTURE conversations.`;
}
