import { CronExpressionParser } from "cron-parser";

/**
 * Compute the next occurrence of a cron schedule in the given timezone.
 * Returns epoch milliseconds.
 */
export function computeNextRun(
  schedule: string,
  timezone: string,
  after?: Date,
): number {
  const expression = CronExpressionParser.parse(schedule, {
    currentDate: after ?? new Date(),
    tz: timezone,
  });
  return expression.next().toDate().getTime();
}
