import { describe, expect, test } from "bun:test";
import {
  createTelegramIntegrationConfig,
  parseTelegramIntegrationConfig,
  safeWebhookResponse,
  verifyTelegramWebhookSecret,
  deriveTelegramWebhookSecret,
} from "./telegram-webhook";

describe("Telegram webhook security", () => {
  test("stores a distinct bot token and webhook secret", () => {
    const raw = createTelegramIntegrationConfig("bot-token", "webhook-secret");
    expect(parseTelegramIntegrationConfig(raw)).toEqual({
      botToken: "bot-token",
      webhookSecret: "webhook-secret",
    });
  });

  test("fails closed for legacy token-only configs", () => {
    expect(parseTelegramIntegrationConfig("legacy-token")).toBeNull();
  });

  test("validates Telegram's secret header", () => {
    expect(verifyTelegramWebhookSecret("expected", "expected")).toBe(true);
    expect(verifyTelegramWebhookSecret(undefined, "expected")).toBe(false);
    expect(verifyTelegramWebhookSecret("wrong", "expected")).toBe(false);
  });

  test("derives a stable per-agent secret from the server key", () => {
    expect(deriveTelegramWebhookSecret("agent-a", "master")).toBe(
      deriveTelegramWebhookSecret("agent-a", "master"),
    );
    expect(deriveTelegramWebhookSecret("agent-a", "master")).not.toBe(
      deriveTelegramWebhookSecret("agent-b", "master"),
    );
  });

  test("never returns the provider webhook URL to the browser", () => {
    const response = safeWebhookResponse("dispatch_bot");
    expect(response).toEqual({ ok: true, botUsername: "dispatch_bot" });
    expect(JSON.stringify(response)).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
  });
});
