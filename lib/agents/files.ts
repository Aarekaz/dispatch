import path from "node:path";
import { getDaytona } from "@/lib/daytona";
import type { WorkspaceFile } from "@/lib/types";

const AGENT_ROOT = "/home/daytona/agent";

/**
 * Validate that a path is within AGENT_ROOT to prevent path traversal.
 */
function assertSafePath(filePath: string): void {
  const normalized = path.posix.normalize(filePath);
  if (!normalized.startsWith(AGENT_ROOT)) {
    throw new Error(`Path must be within ${AGENT_ROOT}`);
  }
  if (normalized.includes("..")) {
    throw new Error("Path traversal not allowed");
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * List the immediate children of a directory on the Daytona sandbox.
 *
 * Non-recursive by design — the client lazily fetches children when the user
 * expands a directory. This converts listing from a "scan the whole tree
 * upfront" operation (slow: one HTTP round-trip per directory × hundreds of
 * directories) to a "pay for what you look at" operation (fast: one HTTP
 * round-trip per user click). See reasoning in the Files panel refactor.
 *
 * Hidden dirs (starting with ".") are still skipped because they're almost
 * always noise (.opencode, .git, .DS_Store) and clutter the top-level view.
 */
export async function listWorkspaceFiles(
  sandboxId: string,
  dirPath: string = AGENT_ROOT,
): Promise<WorkspaceFile[]> {
  assertSafePath(dirPath);
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  const entries = await sandbox.fs.listFiles(dirPath);

  const files: WorkspaceFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = `${dirPath}/${entry.name}`;
    files.push({
      id: Buffer.from(fullPath).toString("base64url"),
      name: entry.name,
      path: fullPath,
      type: entry.isDir ? "directory" : "file",
      size: entry.isDir ? undefined : formatBytes(entry.size),
    });
  }

  // Sort: directories first, then alphabetically
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return files;
}

/**
 * Read a file from the Daytona sandbox. Returns UTF-8 string.
 */
export async function readFile(
  sandboxId: string,
  filePath: string,
): Promise<string> {
  assertSafePath(filePath);
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  const buffer = await sandbox.fs.downloadFile(filePath);
  return buffer.toString("utf-8");
}

/**
 * Write a file to the Daytona sandbox.
 */
export async function writeFile(
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<void> {
  assertSafePath(filePath);
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  await sandbox.fs.uploadFiles([
    { source: Buffer.from(content), destination: filePath },
  ]);
}

/**
 * Write a binary file to the Daytona sandbox.
 * Accepts a raw Buffer — works for any file type (images, PDFs, etc.).
 */
export async function writeFileBuffer(
  sandboxId: string,
  filePath: string,
  buffer: Buffer,
): Promise<void> {
  assertSafePath(filePath);
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  await sandbox.fs.uploadFiles([
    { source: buffer, destination: filePath },
  ]);
}

/**
 * Delete a file from the Daytona sandbox.
 */
export async function deleteFile(
  sandboxId: string,
  filePath: string,
): Promise<void> {
  assertSafePath(filePath);
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  await sandbox.fs.deleteFile(filePath);
}
