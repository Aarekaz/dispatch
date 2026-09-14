/**
 * POST /api/automations/[id]/run — manually trigger an automation.
 *
 * Runs the automation immediately, bypassing schedules and triggers.
 * The agent executes the automation's instructions and the output is
 * delivered to the configured destination.
 *
 * This is the "Run ▶" button in the UI.
 */
import { fetchAuthQuery, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { invokeAutomation } from "@/lib/automations/invoke";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    if (!(await isAuthenticated())) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;

    const automation = await fetchAuthQuery(
      api.agentAutomations.get,
      { id: id as Id<"agentAutomations"> },
    );
    if (!automation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (!automation.instructions?.trim()) {
      return Response.json(
        { error: "No instructions configured. Save your instructions first, then run." },
        { status: 400 },
      );
    }

    console.log(
      `[automations/run] manual trigger id=${id} agent=${automation.agentId} name="${automation.name}"`,
    );

    // Start invocation — race with a 10s timeout so the UI gets feedback
    const resultPromise = invokeAutomation({
      automationId: id,
      agentId: String(automation.agentId),
      triggerKind: "manual",
      triggerDetail: "Manual trigger via UI",
    });

    // Ensure unhandled rejection doesn't crash the process
    resultPromise.catch((err) => {
      console.error("[automations/run] background invocation failed:", err);
    });

    const raceResult = await Promise.race([
      resultPromise.then((r) => ({ done: true as const, result: r })),
      new Promise<{ done: false }>((resolve) =>
        setTimeout(() => resolve({ done: false }), 10_000),
      ),
    ]);

    if (raceResult.done) {
      return Response.json({
        ok: true,
        status: raceResult.result.status,
        summary: raceResult.result.output.slice(0, 200) || "Completed with no output",
        durationMs: raceResult.result.durationMs,
        error: raceResult.result.error,
      });
    }

    // Still running after 10s — return accepted
    return Response.json(
      { ok: true, status: "running", message: "Automation started — check runs for results." },
      { status: 202 },
    );
  } catch (err) {
    console.error("[automations/run] route error:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
