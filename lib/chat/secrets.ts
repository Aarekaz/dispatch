import "server-only";

/**
 * Read the shared internal secret used to authenticate webhook-
 * originated calls to Convex mutations. Used by Chat SDK handlers,
 * the error reporter, the state adapter, and the OAuth routes.
 *
 * Centralized here so changing the env var name is a single-file
 * edit instead of hunting across 6+ files.
 */
export function getSecret(): string {
  const secret = process.env.CHAT_STATE_INTERNAL_SECRET;
  if (!secret) {
    throw new Error(
      "CHAT_STATE_INTERNAL_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.local.",
    );
  }
  return secret;
}
