import { getDaytona } from "@/lib/daytona";
import { readFile, writeFile, deleteFile } from "./files";
import type { MemoryFile } from "@/lib/types";

const MEMORY_ROOT = "/home/daytona/agent/memories";
const AGENTS_MD_PATH = "/home/daytona/agent/AGENTS.md";

type MemoryType = MemoryFile["type"];

/**
 * Infer memory file type from its path.
 */
export function inferType(name: string, path: string): MemoryType {
  if (name === "profile.md") return "profile";
  if (name === "playbook.md") return "playbook";
  if (name === "contacts.json") return "contacts";
  if (path.includes("working-notes")) return "working-note";
  return "working-note";
}

/**
 * List all memory files with preview snippets.
 */
export async function listMemoryFiles(
  sandboxId: string,
): Promise<MemoryFile[]> {
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);

  const results: MemoryFile[] = [];

  // List top-level memory files
  let entries: Array<{ name: string; isDir: boolean; size: number; modTime: string }> = [];
  try {
    entries = await sandbox.fs.listFiles(MEMORY_ROOT);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDir && entry.name === "working-notes") {
      // Recurse into working-notes
      try {
        const notes = await sandbox.fs.listFiles(
          `${MEMORY_ROOT}/working-notes`,
        );
        for (const note of notes) {
          if (note.isDir) continue;
          const path = `${MEMORY_ROOT}/working-notes/${note.name}`;
          let preview = "";
          try {
            const buf = await sandbox.fs.downloadFile(path);
            preview = buf.toString("utf-8").slice(0, 200);
          } catch {}
          results.push({
            id: Buffer.from(path).toString("base64url"),
            name: note.name,
            path,
            type: "working-note",
            preview,
            updatedAt: note.modTime,
          });
        }
      } catch {}
      continue;
    }

    if (entry.isDir) continue;

    const path = `${MEMORY_ROOT}/${entry.name}`;
    let preview = "";
    try {
      const buf = await sandbox.fs.downloadFile(path);
      preview = buf.toString("utf-8").slice(0, 200);
    } catch {}

    results.push({
      id: Buffer.from(path).toString("base64url"),
      name: entry.name,
      path,
      type: inferType(entry.name, path),
      preview,
      updatedAt: entry.modTime,
    });
  }

  return results;
}

/**
 * Read a memory file or AGENTS.md. Validates path.
 */
export async function readMemoryFile(
  sandboxId: string,
  path: string,
): Promise<string> {
  if (!path.startsWith(MEMORY_ROOT) && path !== AGENTS_MD_PATH) {
    throw new Error("Invalid memory path");
  }
  return readFile(sandboxId, path);
}

/**
 * Write a memory file or AGENTS.md. Validates path.
 */
export async function writeMemoryFile(
  sandboxId: string,
  path: string,
  content: string,
): Promise<void> {
  if (!path.startsWith(MEMORY_ROOT) && path !== AGENTS_MD_PATH) {
    throw new Error("Invalid memory path");
  }
  return writeFile(sandboxId, path, content);
}

/**
 * Delete a memory file. Only working-notes can be deleted.
 */
export async function deleteMemoryFile(
  sandboxId: string,
  path: string,
): Promise<void> {
  if (!path.startsWith(`${MEMORY_ROOT}/working-notes/`) || path.includes("..")) {
    throw new Error("Only working notes can be deleted");
  }
  return deleteFile(sandboxId, path);
}

/**
 * Read the agent persona (AGENTS.md).
 */
export async function readPersona(sandboxId: string): Promise<string> {
  return readFile(sandboxId, AGENTS_MD_PATH);
}

/**
 * Write the agent persona (AGENTS.md).
 */
export async function writePersona(
  sandboxId: string,
  content: string,
): Promise<void> {
  return writeFile(sandboxId, AGENTS_MD_PATH, content);
}
