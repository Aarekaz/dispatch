import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ agentId: string }>;
  children: ReactNode;
}) {
  const { agentId } = await params;
  // Convex ids are 32-char base32 strings. Anything else (e.g. a stray
  // top-level path that fell through to [agentId]) is not a real agent —
  // 404 instead of letting it reach Convex validators or redirect to /home.
  if (!/^[a-z0-9]{32}$/.test(agentId)) notFound();
  if (!(await isAuthenticated())) redirect("/sign-in");
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
