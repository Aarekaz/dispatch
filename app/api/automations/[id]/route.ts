/**
 * GET    /api/automations/[id] — get a single automation
 * PATCH  /api/automations/[id] — update an automation
 * DELETE /api/automations/[id] — delete an automation
 */
import { fetchAuthQuery, fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { computeNextRun } from "@/lib/cron/next-run";

type RouteContext = { params: Promise<{ id: string }> };
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
type AutomationUpdateFields = {
  name?: string;
  enabled?: boolean;
  agentId?: Id<"agents">;
  instructions?: string;
  schedules?: AutomationSchedule[];
  triggers?: AutomationTrigger[];
  allowedToolkits?: string[];
  defaultDelivery?: AutomationDelivery;
  nextScheduleAt?: number;
  persistentSessionId?: string;
};

export async function GET(_request: Request, ctx: RouteContext) {
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

  // Also fetch recent runs
  const runs = await fetchAuthQuery(
    api.agentAutomationRuns.list,
    { automationId: id as Id<"agentAutomations">, limit: 10 },
  );

  return Response.json({ automation, runs });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fields = (body ?? {}) as AutomationUpdateFields;

  // Validate schedules if provided
  if (fields.schedules) {
    const schedules = fields.schedules;
    if (schedules.length > 3) {
      return Response.json(
        { error: "Maximum 3 schedules per automation" },
        { status: 400 },
      );
    }
  }

  // Validate triggers if provided
  if (fields.triggers) {
    const triggers = fields.triggers;
    if (triggers.length > 3) {
      return Response.json(
        { error: "Maximum 3 triggers per automation" },
        { status: 400 },
      );
    }
  }

  // Compute nextScheduleAt if schedules changed
  if (fields.schedules) {
    const schedules = fields.schedules;
    if (schedules.length > 0) {
      const nextTimes = schedules.map((s) =>
        computeNextRun(s.cron, s.timezone),
      );
      fields.nextScheduleAt = Math.min(...nextTimes);
    } else {
      fields.nextScheduleAt = undefined;
    }
  }

  await fetchAuthMutation(
    api.agentAutomations.update,
    { id: id as Id<"agentAutomations">, ...fields },
  );

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  await fetchAuthMutation(
    api.agentAutomations.remove,
    { id: id as Id<"agentAutomations"> },
  );

  return Response.json({ ok: true });
}
