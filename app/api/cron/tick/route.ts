import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { computeNextRun } from "@/lib/cron/next-run";
import { invokeAutomation } from "@/lib/automations/invoke";
import { runScanPass, type ScannerTriggerConfig } from "@/lib/automations/triggers/channel-scanner";
import { requireSecretBearer } from "@/lib/security/runtime-auth";

const CRON_SECRET = process.env.CRON_SECRET;
const INTERNAL_SECRET = process.env.CRON_INTERNAL_SECRET;

if (!INTERNAL_SECRET) {
  console.warn("[cron/tick] CRON_INTERNAL_SECRET not configured — cron dispatch disabled");
}

/**
 * GET /api/cron/tick
 * Vercel cron endpoint — dispatches due automations AND legacy crons.
 *
 * Dispatches due automations: scheduled prompts and channel scanners.
 * agentCrons has been fully replaced by agentAutomations.
 *
 * Flow:
 * 1. Verify CRON_SECRET (Vercel injects this automatically)
 * 2. Dispatch due schedule-triggered automations
 * 3. Dispatch due scanner-triggered automations
 * 4. Run automation cleanup (old runs, hourly throttle)
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!requireSecretBearer(auth, CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!INTERNAL_SECRET) {
    return Response.json({ error: "CRON_INTERNAL_SECRET not configured" }, { status: 500 });
  }

  const now = Date.now();
  const results = {
    automations: { dispatched: 0, succeeded: 0, failed: 0 },
    cleanup: { deleted: 0 },
  };

  // ── 1. Dispatch due automations (new path) ────────────
  try {
    const dueAutomations = await fetchQuery(
      api.agentAutomations.listDueSchedules,
      { now, secret: INTERNAL_SECRET },
    );

    results.automations.dispatched = dueAutomations.length;

    const automationResults = await Promise.allSettled(
      dueAutomations.slice(0, 10).map(async (automation) => {
        try {
          const result = await invokeAutomation({
            automationId: String(automation._id),
            agentId: String(automation.agentId),
            triggerKind: "schedule",
            triggerDetail: `Schedule: ${automation.schedules[0]?.cron ?? "unknown"}`,
          });

          // Update nextScheduleAt for the next fire
          if (automation.schedules.length > 0) {
            const nextTimes = automation.schedules.map((s) =>
              computeNextRun(s.cron, s.timezone),
            );
            const nextScheduleAt = Math.min(...nextTimes);

            await fetchMutation(api.agentAutomations.markScheduleRun, {
              id: automation._id,
              nextScheduleAt,
              status: result.status,
              secret: INTERNAL_SECRET!,
            });
          }

          return result.status;
        } catch (err) {
          console.error(`[cron/tick] automation ${automation._id} failed:`, err);
          throw err;
        }
      }),
    );

    // Distinguish three outcomes:
    // - Promise rejected = infrastructure error (invoke threw)
    // - Promise fulfilled with "failed" = automation ran but errored
    // - Promise fulfilled with "success" = actual success
    let succeeded = 0;
    let failed = 0;
    for (const r of automationResults) {
      if (r.status === "rejected") {
        failed++;
      } else if (r.value === "failed") {
        failed++;
      } else {
        succeeded++;
      }
    }
    results.automations.succeeded = succeeded;
    results.automations.failed = failed;
  } catch (err) {
    console.error("[cron/tick] automations dispatch error:", err);
  }

  // ── 2. Dispatch scanner-triggered automations ──────────
  const scanResults = { scanned: 0, reacted: 0, responded: 0 };
  try {
    const scannerAutomations = await fetchQuery(
      api.agentAutomations.listScannerAutomations,
      { secret: INTERNAL_SECRET },
    );

    for (const automation of scannerAutomations.slice(0, 5)) {
      for (const trigger of automation.triggers) {
        if (trigger.type !== "slack.channel_scanner") continue;

        const config = trigger.config as ScannerTriggerConfig;
        const cadenceMs = (config.cadenceHours ?? 6) * 60 * 60 * 1000;
        const scanTimes = (automation.scannerLastScanAt as Record<string, number>) ?? {};
        const lastScanAt = scanTimes[trigger.id] ?? 0;

        // Skip if not enough time has passed since last scan
        if (now - lastScanAt < cadenceMs) continue;

        try {
          // Fetch the agent for name/persona/toolkits (needed by classifier)
          const agent = await fetchQuery(api.agents.getInternal, {
            id: automation.agentId,
            secret: INTERNAL_SECRET!,
          });
          if (!agent) continue;

          const result = await runScanPass({
            automation: {
              _id: String(automation._id),
              agentId: String(automation.agentId),
              name: automation.name,
              instructions: automation.instructions,
              composioToolkits: agent.composioToolkits,
            },
            trigger: { id: trigger.id, config },
            agent: {
              name: agent.name,
              persona: agent.persona ?? undefined,
              composioToolkits: agent.composioToolkits,
            },
            lastScanAt: lastScanAt || undefined,
          });

          scanResults.scanned++;
          scanResults.reacted += result.reacted;
          scanResults.responded += result.responded;
        } catch (err) {
          console.error(
            `[cron/tick] scanner ${automation._id}/${trigger.id} failed:`,
            err,
          );
        }
      }
    }
  } catch (err) {
    console.error("[cron/tick] scanner dispatch error:", err);
  }

  // ── 3. Periodic cleanup (hourly throttle) ─────────────
  // Run cleanup only on minute :00 to avoid hammering on every tick
  const minute = new Date(now).getMinutes();
  if (minute === 0) {
    try {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const cleanupResult = await fetchMutation(
        api.agentAutomationRuns.cleanup,
        { olderThanMs: thirtyDaysMs, secret: INTERNAL_SECRET },
      );
      results.cleanup.deleted = cleanupResult.deleted;
    } catch (err) {
      console.error("[cron/tick] cleanup error:", err);
    }
  }

  console.log(
    `[cron/tick] schedules=${results.automations.dispatched}/${results.automations.succeeded}ok`,
    `scanners=${scanResults.scanned}/reacted=${scanResults.reacted}/responded=${scanResults.responded}`,
    `cleanup=${results.cleanup.deleted}`,
  );

  return Response.json({ ...results, scanners: scanResults });
}
