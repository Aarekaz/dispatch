/**
 * Per-agent toolkit authorization helper.
 *
 * Implements the Composio-recommended "manual authorization" pattern
 * from `tr-auth-manual.md`: create a scoped Tool Router session for
 * (agent, toolkit), call `session.authorize()`, return the hosted
 * OAuth redirect URL. The caller opens that URL in a popup and polls
 * the callback page for completion.
 *
 * Why a fresh session per Connect click rather than reusing the
 * cached MCP session from `getComposioMcpConfig`:
 *
 *   - `getComposioMcpConfig` deliberately returns only `{url, headers}`
 *     (not the full Session object) because its only job is to feed
 *     the OpenCode MCP config. Refactoring its return type to expose
 *     the Session just so Connect could reach `session.authorize()`
 *     would couple two unrelated code paths — the cache semantics get
 *     messy and one helper would serve two masters.
 *   - Connect is a rare user action (user clicks a button). The cost
 *     of creating a tiny one-toolkit session per click is negligible
 *     compared to the clarity win of keeping the two helpers separate.
 *
 * Per-agent identity (`${userId}:${agentId}`) is applied via the
 * same `composioIdentityFor()` helper that the MCP session uses,
 * so connections land in the correct per-agent pool regardless of
 * whether the user connected via the settings UI or via the agent's
 * in-chat `COMPOSIO_MANAGE_CONNECTIONS` flow.
 */
import { getComposio } from "./client";
import { composioIdentityFor } from "./session";

export type InitiateConnectionResult = {
  redirectUrl: string;
  connectionId: string;
};

export async function initiateConnection(params: {
  userId: string;
  agentId: string;
  toolkit: string;
  callbackUrl: string;
}): Promise<InitiateConnectionResult | null> {
  const { userId, agentId, toolkit, callbackUrl } = params;

  try {
    const composio = getComposio();
    const identity = composioIdentityFor(userId, agentId);

    // Per the docs, a settings-page connect flow creates a small
    // session scoped to just the toolkit being authorized. This is
    // what lets us call `session.authorize(...)` below.
    const session = await composio.create(identity, {
      toolkits: [toolkit],
    });

    const connectionRequest = await session.authorize(toolkit, {
      callbackUrl,
    });

    // Composio's ConnectionRequest type marks `redirectUrl` as
    // optional. It should always be present for hosted-auth flows;
    // if it's missing something went wrong upstream and we surface
    // null to the caller (which becomes a clean error toast).
    if (!connectionRequest.redirectUrl) {
      console.error(
        "[composio/connect] session.authorize returned no redirectUrl",
        { toolkit, identity: identity.slice(-12) },
      );
      return null;
    }

    return {
      redirectUrl: connectionRequest.redirectUrl,
      connectionId: connectionRequest.id,
    };
  } catch (err) {
    console.error("[composio/connect] initiateConnection failed:", err);
    return null;
  }
}
