/**
 * Haiku-based classifier for the channel scanner trigger.
 *
 * Takes a candidate Slack message + agent context, returns a verdict
 * (respond / react_only / skip) with confidence and reason.
 *
 * Defensive boundary: zod schema validates the raw LLM output,
 * clamps confidence to [0,1], defaults to skip on any failure.
 * Every branch logs one structured line.
 */
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});
import { buildClassifierPrompt } from "./classifier-prompt";

export type ClassifierResult = {
  verdict: "respond" | "react_only" | "skip";
  confidence: number;
  reason: string;
};

const CONFIDENCE_THRESHOLD = 0.75;

const resultSchema = z.object({
  verdict: z.enum(["respond", "react_only", "skip"]),
  confidence: z.number(),
  reason: z.string().max(300),
});

export async function classifyCandidate(params: {
  agent: { name: string; persona?: string; capabilities: string[] };
  channelName: string;
  recentContext: string;
  candidate: { text: string; user: string; ts: string };
}): Promise<ClassifierResult> {
  const ageHours =
    (Date.now() - parseFloat(params.candidate.ts) * 1000) / (1000 * 60 * 60);

  const prompt = buildClassifierPrompt({
    agentName: params.agent.name,
    personaOneLiner: params.agent.persona,
    capabilityPhrases: params.agent.capabilities.join(", "),
    channelName: params.channelName,
    last10Messages: params.recentContext,
    candidateText: params.candidate.text,
    candidateUser: params.candidate.user,
    ageHours,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const { text: rawOutput } = await generateText({
      model: openrouter("anthropic/claude-haiku-4.5"),
      system: prompt.system,
      prompt: prompt.user,
      maxOutputTokens: 150,
      abortSignal: controller.signal,
    });

    clearTimeout(timeout);

    // Strip markdown fences if Haiku wrapped them
    const cleaned = rawOutput
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.log(
        `[classifier] parse_error ts=${params.candidate.ts} raw=${rawOutput.slice(0, 100)}`,
      );
      return { verdict: "skip", confidence: 0, reason: "parse_error" };
    }

    const validated = resultSchema.safeParse(parsed);
    if (!validated.success) {
      console.log(
        `[classifier] validation_error ts=${params.candidate.ts} errors=${validated.error.message}`,
      );
      return { verdict: "skip", confidence: 0, reason: "validation_error" };
    }

    // Clamp confidence to [0, 1]
    const confidence = Math.max(0, Math.min(1, validated.data.confidence));

    // Downgrade respond to react_only if confidence is below threshold
    let { verdict } = validated.data;
    if (verdict === "respond" && confidence < CONFIDENCE_THRESHOLD) {
      verdict = "react_only";
    }

    console.log(
      `[classifier] verdict=${verdict} confidence=${confidence.toFixed(2)} ts=${params.candidate.ts} reason=${validated.data.reason}`,
    );

    return { verdict, confidence, reason: validated.data.reason };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.log(
        `[classifier] timeout ts=${params.candidate.ts}`,
      );
      return { verdict: "skip", confidence: 0, reason: "classifier_timeout" };
    }

    console.error(
      `[classifier] error ts=${params.candidate.ts}`,
      err,
    );
    return { verdict: "skip", confidence: 0, reason: "classifier_error" };
  }
}
