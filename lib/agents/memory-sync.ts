/**
 * Memory sync engine — filesystem → Convex.
 *
 * Reads memory files from the Daytona sandbox, diffs against Convex
 * by content hash, and upserts only changed files. Called in the
 * background after cold starts, automation completions, and on demand
 * via the force-sync button.
 *
 * Never blocks the agent or the user. Never wakes a stopped sandbox.
 */
import crypto from "crypto";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { listMemoryFiles, readMemoryFile } from "./memory";
import { perfTimer } from "@/lib/perf";

export type SyncResult = {
  upserted: number;
  unchanged: number;
  deleted: number;
  durationMs: number;
};

function getSecret(): string {
  return process.env.CRON_INTERNAL_SECRET ?? "";
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Full sync: read all memory files from sandbox, diff against Convex,
 * upsert changes. Returns stats.
 */
export async function syncAgentMemory(
  agentId: string,
  sandboxId: string,
): Promise<SyncResult> {
  const timer = perfTimer("memory-sync", { agentId: agentId.slice(-8) });
  const secret = getSecret();
  const start = Date.now();

  // 1. List memory files from sandbox
  const sandboxFiles = await listMemoryFiles(sandboxId);

  // 2. Read full content for each file (parallel)
  const fileContents = await Promise.allSettled(
    sandboxFiles.map(async (f) => {
      const content = await readMemoryFile(sandboxId, f.path);
      return {
        path: f.path,
        name: f.name,
        type: f.type,
        content,
        contentHash: hashContent(content),
      };
    }),
  );

  const filesToSync: Array<{
    path: string;
    name: string;
    type: string;
    content: string;
    contentHash: string;
  }> = [];
  for (const r of fileContents) {
    if (r.status === "fulfilled") filesToSync.push(r.value);
  }

  // 3. Get existing Convex hashes for diff
  const existing = await fetchQuery(api.agentMemoryFiles.getByAgentInternal, {
    agentId,
    secret,
  });
  const existingByPath = new Map(existing.map((f) => [f.path, f]));

  // 4. Filter to only changed/new files
  const changed = filesToSync.filter((f) => {
    const conv = existingByPath.get(f.path);
    return !conv || conv.contentHash !== f.contentHash;
  });

  // 5. Find deleted files (in Convex but not on sandbox)
  const sandboxPaths = new Set(filesToSync.map((f) => f.path));
  const deletedPaths = existing
    .filter((f) => !sandboxPaths.has(f.path))
    .map((f) => f.path);

  // 6. Upsert changed files
  let upserted = 0;
  let unchanged = filesToSync.length - changed.length;

  if (changed.length > 0) {
    const result = await fetchMutation(api.agentMemoryFiles.upsertBatch, {
      agentId,
      files: changed,
      secret,
    });
    upserted = result.upserted;
    unchanged = result.unchanged + unchanged;
  }

  // 7. Soft-delete removed files
  let deleted = 0;
  if (deletedPaths.length > 0) {
    const result = await fetchMutation(api.agentMemoryFiles.markDeleted, {
      agentId,
      paths: deletedPaths,
      secret,
    });
    deleted = result.deleted;
  }

  const durationMs = Date.now() - start;
  timer.end({ upserted, unchanged, deleted });

  return { upserted, unchanged, deleted, durationMs };
}

/**
 * Fire-and-forget sync. Never throws, never blocks.
 * Use this from background hooks (cold start, automation complete).
 */
export function trySyncAgentMemory(
  agentId: string,
  sandboxId: string,
): void {
  syncAgentMemory(agentId, sandboxId).catch((err) => {
    console.warn("[memory-sync] background sync failed:", err);
  });
}
