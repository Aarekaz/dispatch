import { getToken } from "@/lib/auth-server";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getDaytona } from "@/lib/daytona";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import {
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  deleteMemoryFile,
  readPersona,
  writePersona,
  inferType,
} from "@/lib/agents/memory";
import { perfTimer } from "@/lib/perf";

/**
 * Helper: auth + agent lookup. Does NOT wake sandbox.
 */
async function getAgent(agentId: string) {
  const token = await getToken();
  if (!token) return { error: "Unauthorized", status: 401 } as const;

  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  if (!agent) return { error: "Agent not found", status: 404 } as const;
  if (!agent.sandboxId) return { error: "Agent not provisioned", status: 400 } as const;

  return { agent, sandboxId: agent.sandboxId, token } as const;
}

/**
 * Check if sandbox is running without waking it.
 */
async function isSandboxRunning(sandboxId: string): Promise<boolean> {
  try {
    const daytona = getDaytona();
    const sandbox = await daytona.get(sandboxId);
    const state = (sandbox as { state?: string }).state ?? "unknown";
    return state === "started" || state === "running";
  } catch {
    return false;
  }
}

/**
 * GET /api/agents/[id]/memory
 *   No params:       list all memory files
 *   ?file=<path>:    read specific memory file content
 *   ?type=persona:   read AGENTS.md
 *
 * When sandbox is running: reads from filesystem (freshest data).
 * When sandbox is stopped: reads from Convex (no wake needed).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const file = url.searchParams.get("file");
  const timer = perfTimer("memory.get.route", {
    kind: type === "persona" ? "persona" : file ? "file" : "list",
  });

  const result = await getAgent(id);
  if ("error" in result) {
    timer.end({ status: "auth-fail" });
    return Response.json({ error: result.error }, { status: result.status });
  }

  const { agent, sandboxId, token } = result;
  const running = await isSandboxRunning(sandboxId);

  // Persona always needs the sandbox (it's a config file, not memory)
  if (type === "persona") {
    if (!running) {
      await ensureAgentRunning(sandboxId, agentContextFromRow(agent, id));
    }
    try {
      const content = await readPersona(sandboxId);
      timer.end({ status: "ok", source: "sandbox" });
      return Response.json({ content });
    } catch (error) {
      timer.end({ status: "error" });
      return Response.json({ error: `${error}` }, { status: 500 });
    }
  }

  // Memory file listing or single file read
  if (running) {
    // Sandbox is running — read from filesystem (freshest)
    try {
      if (file) {
        const content = await readMemoryFile(sandboxId, file);
        timer.end({ status: "ok", source: "sandbox" });
        return Response.json({ content, path: file, source: "sandbox" });
      }
      const files = await listMemoryFiles(sandboxId);
      timer.end({ status: "ok", source: "sandbox" });
      return Response.json(files);
    } catch (error) {
      timer.end({ status: "error" });
      return Response.json({ error: `${error}` }, { status: 500 });
    }
  }

  // Sandbox is stopped — read from Convex (no wake)
  try {
    const convexFiles = await fetchQuery(
      api.agentMemoryFiles.listByAgent,
      { agentId: id as Id<"agents"> },
      { token },
    );

    if (file) {
      const match = convexFiles.find((f) => f.path === file);
      if (!match) {
        timer.end({ status: "not-found", source: "convex" });
        return Response.json({ error: "File not found in synced data" }, { status: 404 });
      }
      timer.end({ status: "ok", source: "convex" });
      return Response.json({ content: match.content, path: match.path, source: "convex" });
    }

    // Return in the same MemoryFile shape as the filesystem listing
    const files = convexFiles.map((f) => ({
      id: btoa(f.path).replace(/[+/=]/g, (c) =>
        c === "+" ? "-" : c === "/" ? "_" : "",
      ),
      name: f.name,
      path: f.path,
      type: f.type,
      preview: f.preview,
      updatedAt: new Date(f.syncedAt).toISOString(),
      source: "convex" as const,
    }));
    timer.end({ status: "ok", source: "convex", count: files.length });
    return Response.json(files);
  } catch (error) {
    timer.end({ status: "convex-error" });
    return Response.json({ error: `${error}` }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/memory
 * Body: { path, content }
 *
 * Writes to sandbox (if running) AND to Convex (dual-write).
 * When sandbox is stopped, writes to Convex only (pushed on next boot).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgent(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const { path, content } = body as { path: string; content: string };
  if (!path || content === undefined) {
    return Response.json({ error: "path and content are required" }, { status: 400 });
  }

  const { sandboxId } = result;
  const running = await isSandboxRunning(sandboxId);

  // Write to sandbox if running
  if (running) {
    try {
      if (path.endsWith("AGENTS.md")) {
        await writePersona(sandboxId, content);
      } else {
        await writeMemoryFile(sandboxId, path, content);
      }
    } catch (error) {
      return Response.json({ error: `${error}` }, { status: 500 });
    }
  }

  // Dual-write to Convex (always, even if sandbox write succeeded)
  if (!path.endsWith("AGENTS.md")) {
    try {
      const fileName = path.split("/").pop() ?? "unknown";
      await fetchMutation(api.agentMemoryFiles.upsertFromUI, {
        agentId: id as Id<"agents">,
        path,
        name: fileName,
        type: inferType(fileName, path),
        content,
      });
    } catch (err) {
      console.warn("[memory/PUT] Convex upsert failed (non-critical):", err);
    }
  }

  return Response.json({ ok: true });
}

/**
 * DELETE /api/agents/[id]/memory
 * Body: { path }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgent(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const { path } = body as { path: string };
  if (!path) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  const { sandboxId } = result;
  const running = await isSandboxRunning(sandboxId);

  // Delete from sandbox if running
  if (running) {
    try {
      await deleteMemoryFile(sandboxId, path);
    } catch (error) {
      return Response.json({ error: `${error}` }, { status: 500 });
    }
  }

  // Also mark deleted in Convex
  try {
    const secret = process.env.CRON_INTERNAL_SECRET ?? "";
    await fetchMutation(api.agentMemoryFiles.markDeleted, {
      agentId: id,
      paths: [path],
      secret,
    });
  } catch (err) {
    console.warn("[memory/DELETE] Convex markDeleted failed (non-critical):", err);
  }

  return Response.json({ ok: true });
}
