/**
 * GET  /api/automations — list all automations for the authenticated user
 * POST /api/automations — create a new automation
 */
import { fetchAuthQuery, fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { computeNextRun } from "@/lib/cron/next-run";
import { CronExpressionParser } from "cron-parser";

type AutomationSchedule = { id: string; cron: string; timezone: string };
type AutomationTrigger = {
  id: string;
  type: string;
  label?: string;
  config: unknown;
};
type AutomationDelivery = {
  type: "activity_log" | "slack_channel" | "telegram_channel" | "slack_thread";
  config?: unknown;
};

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const automations = await fetchAuthQuery(
    api.agentAutomations.listAll,
    {},
  );

  return Response.json({ automations });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    agentId,
    name,
    instructions,
    schedules,
    triggers,
    allowedToolkits,
    defaultDelivery,
  } = (body ?? {}) as {
    agentId?: string;
    name?: string;
    instructions?: string;
    schedules?: AutomationSchedule[];
    triggers?: AutomationTrigger[];
    allowedToolkits?: string[];
    defaultDelivery?: AutomationDelivery;
  };

  if (!agentId || typeof agentId !== "string") {
    return Response.json({ error: "agentId is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  // Validate schedules
  if (schedules && schedules.length > 3) {
    return Response.json(
      { error: "Maximum 3 schedules per automation" },
      { status: 400 },
    );
  }
  for (const s of schedules ?? []) {
    try {
      CronExpressionParser.parse(s.cron);
    } catch {
      return Response.json(
        { error: `Invalid cron expression: ${s.cron}` },
        { status: 400 },
      );
    }
  }

  // Validate triggers
  if (triggers && triggers.length > 3) {
    return Response.json(
      { error: "Maximum 3 triggers per automation" },
      { status: 400 },
    );
  }

  const id = await fetchAuthMutation(
    api.agentAutomations.create,
    {
      agentId: agentId as Id<"agents">,
      name: name.trim(),
      instructions: instructions ?? "",
      schedules,
      triggers,
      allowedToolkits,
      defaultDelivery,
    },
  );

  // Compute nextScheduleAt if schedules exist
  if (schedules && schedules.length > 0) {
    const nextTimes = schedules.map((s) => computeNextRun(s.cron, s.timezone));
    const nextScheduleAt = Math.min(...nextTimes);

    await fetchAuthMutation(
      api.agentAutomations.update,
      { id, nextScheduleAt },
    );
  }

  return Response.json({ id }, { status: 201 });
}
