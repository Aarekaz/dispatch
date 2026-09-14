import { getToken } from "@/lib/auth-server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ensureAgentRunning, agentContextFromRow } from "@/lib/agents/ensure-running";
import { readFile, writeFile, writeFileBuffer, deleteFile } from "@/lib/agents/files";

/**
 * Helper: auth + agent lookup + ensure sandbox running.
 *
 * Passes full agent context so a cold start triggered from this
 * endpoint rebuilds OpenCode WITH the Composio MCP block.
 */
async function getAgentSandbox(agentId: string) {
  const token = await getToken();
  if (!token) return { error: "Unauthorized", status: 401 } as const;

  const agent = await fetchQuery(api.agents.get, { id: agentId as Id<"agents"> }, { token });
  if (!agent) return { error: "Agent not found", status: 404 } as const;
  if (!agent.sandboxId) return { error: "Agent not provisioned", status: 400 } as const;

  await ensureAgentRunning(agent.sandboxId, agentContextFromRow(agent, agentId));
  return { sandboxId: agent.sandboxId } as const;
}

/**
 * GET /api/agents/[id]/file?path=...
 * Read a single file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgentSandbox(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const content = await readFile(result.sandboxId, path);
    return Response.json({ content, path });
  } catch (error) {
    return Response.json({ error: `Failed to read file: ${error}` }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/file
 * Upload/write a file. Body: { path, content }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgentSandbox(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const { path, content } = body as { path: string; content: string };
  if (!path || content === undefined) {
    return Response.json({ error: "path and content are required" }, { status: 400 });
  }

  try {
    await writeFile(result.sandboxId, path, content);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: `Failed to write file: ${error}` }, { status: 500 });
  }
}

/**
 * POST /api/agents/[id]/file
 * Upload a binary file via multipart/form-data.
 * Fields: file (File), path (string — target directory in sandbox).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgentSandbox(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const targetDir = (formData.get("path") as string) || "/home/daytona/agent";

  if (!file) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  // Build the full destination path — target directory + filename.
  const destination = `${targetDir.replace(/\/$/, "")}/${file.name}`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFileBuffer(result.sandboxId, destination, buffer);
    return Response.json({ ok: true, path: destination, size: buffer.length });
  } catch (error) {
    return Response.json({ error: `Failed to upload file: ${error}` }, { status: 500 });
  }
}

/**
 * DELETE /api/agents/[id]/file?path=...
 * Delete a file.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAgentSandbox(id);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }

  try {
    await deleteFile(result.sandboxId, path);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: `Failed to delete file: ${error}` }, { status: 500 });
  }
}
