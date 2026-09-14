import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { isAuthenticated } from "@/lib/auth-server";
import { FocusedShell } from "@/components/focused-shell";

export default async function FocusedLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  return <FocusedShell>{children}</FocusedShell>;
}
