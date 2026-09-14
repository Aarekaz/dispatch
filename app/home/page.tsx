import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";

/**
 * Legacy `/home` entrypoint.
 *
 * Keep old bookmarks working. Users with agents still land in their
 * most-recent workspace; users without agents land in `/agents`.
 */
export default async function HomeRedirect() {
  if (!(await isAuthenticated())) {
    redirect("/sign-in");
  }

  const agents = await fetchAuthQuery(api.agents.list, {});
  if (agents.length > 0) {
    redirect(`/${agents[0].id}/home` as Route);
  }

  redirect("/agents");
}
