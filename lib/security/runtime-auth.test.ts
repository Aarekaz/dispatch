import { describe, expect, test } from "bun:test";
import { basicAuthorization, requireSecretBearer } from "./runtime-auth";

describe("runtime authentication", () => {
  test("builds OpenCode basic auth with the documented default username", () => {
    expect(basicAuthorization("secret value")).toBe(
      `Basic ${Buffer.from("opencode:secret value").toString("base64")}`,
    );
  });

  test("rejects missing runtime passwords", () => {
    expect(() => basicAuthorization("")).toThrow("password is required");
  });

  test("cron bearer auth fails closed when the configured secret is absent", () => {
    expect(requireSecretBearer("Bearer undefined", undefined)).toBe(false);
    expect(requireSecretBearer("Bearer ", "")).toBe(false);
  });

  test("cron bearer auth accepts only the configured secret", () => {
    expect(requireSecretBearer("Bearer expected", "expected")).toBe(true);
    expect(requireSecretBearer("Bearer other", "expected")).toBe(false);
  });
});
