import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";

/**
 * Product entrypoint — smart redirect based on who the user is.
 *
 * - Signed-out:              `/sign-in`
 * - Signed-in + has agents:  `/{firstAgent.id}/home`
 * - Signed-in, no agents:    `/agents`
 */
export default async function AppEntryPage() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }

  const agents = await fetchAuthQuery(api.agents.list, {});
  if (agents.length > 0) {
    redirect(`/${agents[0].id}/home` as Route);
  }
  redirect("/agents");
}
