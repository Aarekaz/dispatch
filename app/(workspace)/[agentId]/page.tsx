import { redirect } from "next/navigation";

/**
 * Bare agent URL → redirect to /home.
 *
 * The workspace shell uses explicit segments for every view
 * (/home, /activity, /connect, /automations, /files, /settings).
 * `/[agentId]` alone has no semantic meaning, so it bounces to the
 * default view to keep URLs unambiguous.
 */
export default async function AgentRootPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  redirect(`/${agentId}/home`);
}
