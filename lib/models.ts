/**
 * Centralized model configuration — single source of truth.
 * All models are accessed via OpenRouter.
 */

export type ModelTier = "default" | "premium" | "fast" | "budget";

export interface ModelDefinition {
  id: string;          // OpenRouter ID: "provider/model"
  label: string;       // Display name
  provider: string;    // Provider name for UI grouping
  tier: ModelTier;
  contextWindow: number;
  isDefault?: boolean;
  /**
   * Whether the model supports streaming reasoning/thinking tokens.
   * Propagated into OpenCode's provider config as `reasoning: true` so
   * the adapter attempts to surface reasoning parts in the event stream.
   * Actual flow depends on the upstream model + OpenRouter + adapter combo —
   * see docs/superpowers/specs/2026-04-06-reasoning-streaming-design.md.
   */
  reasoning?: boolean;
}

export const MODELS: ModelDefinition[] = [
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "OpenAI",
    tier: "fast",
    contextWindow: 400_000,
    isDefault: true,
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    provider: "Moonshot",
    tier: "default",
    contextWindow: 262_144,
    reasoning: true, // Phase 1 diagnostic
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
    tier: "premium",
    contextWindow: 1_000_000,
    reasoning: true, // Phase 1 diagnostic
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    tier: "premium",
    contextWindow: 1_000_000,
    reasoning: true, // Phase 1 diagnostic
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    provider: "OpenAI",
    tier: "premium",
    contextWindow: 1_050_000,
    reasoning: true, // Phase 1 diagnostic
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "Google",
    tier: "premium",
    contextWindow: 1_000_000,
    reasoning: true, // Phase 1 diagnostic
  },
  {
    id: "google/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash",
    provider: "Google",
    tier: "fast",
    contextWindow: 1_000_000,
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    provider: "DeepSeek",
    tier: "budget",
    contextWindow: 128_000,
  },
];

export const DEFAULT_MODEL = MODELS.find((m) => m.isDefault)!;

/**
 * Returns the OpenCode-compatible model map for the provider config.
 * Format: { "provider/model": { name: "Display Name", reasoning?: true } }
 *
 * The `reasoning` flag advertises to OpenCode that the model supports
 * reasoning/thinking streaming — when present, the provider adapter
 * (e.g. @ai-sdk/openai-compatible) attempts to surface reasoning parts
 * in the OpenCode event stream. See the reasoning-streaming design doc.
 */
export function getOpenCodeModelMap(): Record<
  string,
  { name: string; reasoning?: boolean }
> {
  const map: Record<string, { name: string; reasoning?: boolean }> = {};
  for (const m of MODELS) {
    map[m.id] = { name: m.label, ...(m.reasoning && { reasoning: true }) };
  }
  return map;
}

/**
 * Returns the OpenCode model reference format: "openrouter/provider/model"
 */
export function getOpenCodeModelRef(modelId: string): string {
  return `openrouter/${modelId}`;
}

/**
 * Find a model by ID, returns undefined if not found.
 */
export function getModel(id: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === id);
}
