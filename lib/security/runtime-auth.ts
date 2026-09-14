import { timingSafeEqual } from "node:crypto";

export function basicAuthorization(password: string): string {
  if (!password) throw new Error("OpenCode server password is required");
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

export function requireSecretBearer(
  authorization: string | null,
  configuredSecret: string | undefined,
): boolean {
  if (!authorization || !configuredSecret) return false;
  const expected = Buffer.from(`Bearer ${configuredSecret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
