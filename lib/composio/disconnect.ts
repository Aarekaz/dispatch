/**
 * Per-agent toolkit disconnection helper.
 *
 * Deletes a connected account for the `(userId, agentId, toolkit)`
 * triple. Calls Composio's `connectedAccounts.delete()` under the
 * hood, which permanently removes the OAuth credentials from
 * Composio's vault. The next time the agent tries to use that
 * toolkit it will either:
 *
 *   - Fail the call and surface an error (if the toolkit is still
 *     in the agent's `composioToolkits` list)
 *   - Trigger the in-chat `COMPOSIO_MANAGE_CONNECTIONS` flow to
 *     re-authenticate (because we pass `manageConnections: true`
 *     on every session)
 *
 * ## Why delete vs. disable?
 *
 * Composio's API supports both `delete` (destructive) and
 * `disable` (non-destructive). The docs recommend `disable` for
 * lifecycle management, but for our "Disconnect" button the user
 * mental model is "revoke this link entirely" — which maps to
 * `delete`. If the user wants to keep the agent's access to the
 * toolkit while revoking the specific account, they can just
 * reconnect to a different account (each agent/toolkit pair only
 * holds one ACTIVE connection at a time under our identity scheme).
 *
 * ## Security
 *
 * We deliberately do NOT expose a "delete by connection ID"
 * endpoint. A malicious user with a stolen auth token could guess
 * connection IDs and delete connections belonging to other agents.
 * Instead, the endpoint takes `(agentId, toolkit)`, we verify
 * ownership of the agent, we look up the ACTIVE connection for
 * the agent's identity, and we delete THAT specific record. This
 * means the caller can only delete connections for agents they own.
 */
import { getComposio } from "./client";
import { composioIdentityFor } from "./session";

export type DisconnectResult =
  | { ok: true; deletedConnectionId: string }
  | { ok: false; error: string };

export async function disconnectToolkit(params: {
  userId: string;
  agentId: string;
  toolkit: string;
}): Promise<DisconnectResult> {
  const { userId, agentId, toolkit } = params;
  const identity = composioIdentityFor(userId, agentId);

  try {
    const composio = getComposio();

    // Step 1: find the ACTIVE connection for this (identity, toolkit).
    // We filter by BOTH userId (our composite identity) and toolkit
    // so a malicious caller can't delete someone else's account by
    // brute-forcing an endpoint.
    const listRes = await composio.connectedAccounts.list({
      userIds: [identity],
      toolkitSlugs: [toolkit],
      statuses: ["ACTIVE"],
    });

    const items: unknown[] = Array.isArray(listRes)
      ? listRes
      : Array.isArray((listRes as { items?: unknown[] })?.items)
        ? (listRes as { items: unknown[] }).items
        : [];

    if (items.length === 0) {
      return {
        ok: false,
        error: `No active ${toolkit} connection found for this agent`,
      };
    }

    // First ACTIVE wins. In principle there could be multiple; in
    // practice Composio deduplicates by (userId, toolkit) so this
    // is a one-item list.
    const account = items[0] as { id?: string };
    if (!account.id) {
      return {
        ok: false,
        error: "Connection record is missing an ID",
      };
    }

    // Step 2: delete it.
    await composio.connectedAccounts.delete(account.id);

    return { ok: true, deletedConnectionId: account.id };
  } catch (err) {
    console.error("[composio/disconnect] disconnectToolkit failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
