/**
 * Singleton Composio client.
 *
 * Environment variable required: COMPOSIO_API_KEY
 * (set in .env.local for dev and in Vercel project env for prod/preview)
 *
 * We pick `VercelProvider` because its session API exposes
 * `session.mcp.{url,headers}` directly — which is the only thing we need
 * to inject Composio as a remote MCP server into the OpenCode config.
 * We are NOT using this provider to wrap tools for the AI SDK directly;
 * the tool loop lives inside OpenCode in the Daytona sandbox, not in
 * the Next.js chat route. See lib/agents/ensure-running.ts for the
 * injection point.
 */
import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

let client: Composio<VercelProvider> | null = null;

export function getComposio(): Composio<VercelProvider> {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error(
        "COMPOSIO_API_KEY is not set. Add it to .env.local (dev) and " +
          "your Vercel project env (prod/preview). The agent runtime " +
          "will soft-fail without Composio tools if this is missing, " +
          "but the getComposio() helper itself throws so configuration " +
          "errors surface loudly rather than silently disabling tools.",
      );
    }
    client = new Composio({
      apiKey,
      provider: new VercelProvider(),
    });
  }
  return client;
}
