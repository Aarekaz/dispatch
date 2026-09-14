"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sileo } from "sileo";

import { Button } from "@/components/ui/button";

/* ── Danger zone section ─────────────────────────────────── */
//
// One real action: delete the agent. Same wiring as the previous
// Settings tab — DELETE /api/agents/[id] which removes the agent
// from Convex and (TODO) cleans up the Daytona sandbox/volume.

export function AgentManagementDangerZone({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  function confirmDelete() {
    sileo.action({
      title: `Delete ${agentName}?`,
      description:
        "This is permanent. All memory, files, schedules, and run history will be lost.",
      duration: null,
      button: {
        title: "Confirm delete",
        onClick: () => {
          setDeleting(true);
          const promise = fetch(`/api/agents/${agentId}`, {
            method: "DELETE",
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error ?? "Delete failed");
            }
            router.push("/app");
          });

          sileo.promise(promise, {
            loading: {
              title: "Deleting agent",
              description: `Removing ${agentName}…`,
              duration: null,
            },
            success: {
              title: "Agent deleted",
              description: `${agentName} has been removed.`,
              duration: 4000,
            },
            error: (err) => ({
              title: "Delete failed",
              description:
                err instanceof Error ? err.message : "Something went wrong.",
              duration: null,
            }),
          });

          promise.catch(() => {}).finally(() => setDeleting(false));
        },
      },
    });
  }

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          Danger zone
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Permanent actions. No undo.
        </p>
      </header>

      <div className="flex items-start justify-between gap-4">
        <p className="max-w-md text-xs text-muted-foreground">
          Delete this agent. All memory, files, schedules, and run history
          will be removed.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={confirmDelete}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete agent"}
        </Button>
      </div>
    </section>
  );
}
