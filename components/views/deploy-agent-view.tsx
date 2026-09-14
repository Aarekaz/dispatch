import { Suspense } from "react";

import { CreateAgentForm } from "@/components/create-agent-form";

/* ── Deploy agent view ───────────────────────────────────── */
//
// Thin wrapper around CreateAgentForm. The form owns its full
// layout (title, hero, sections, deploy button) — this view just
// provides the Suspense boundary that useSearchParams requires.

export function DeployAgentView() {
  return (
    <Suspense fallback={null}>
      <CreateAgentForm />
    </Suspense>
  );
}
