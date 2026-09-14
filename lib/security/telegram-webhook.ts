import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramIntegrationConfig = {
  botToken: string;
  webhookSecret: string;
};

export function createTelegramIntegrationConfig(botToken: string, webhookSecret: string): string {
  return JSON.stringify({ botToken, webhookSecret });
}

export function deriveTelegramWebhookSecret(agentId: string, masterSecret: string): string {
  if (!masterSecret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
  return createHmac("sha256", masterSecret).update(agentId).digest("hex");
}

export function parseTelegramIntegrationConfig(raw: string): TelegramIntegrationConfig | null {
  try {
    const value = JSON.parse(raw) as Partial<TelegramIntegrationConfig>;
    if (!value.botToken || !value.webhookSecret) return null;
    return { botToken: value.botToken, webhookSecret: value.webhookSecret };
  } catch {
    return null;
  }
}

export function verifyTelegramWebhookSecret(supplied: string | null | undefined, expected: string): boolean {
  if (!supplied || !expected) return false;
  const actual = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function safeWebhookResponse(botUsername: string) {
  return { ok: true as const, botUsername };
}
