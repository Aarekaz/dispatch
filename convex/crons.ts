import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Convex scheduled jobs.
 *
 * Currently registers the Chat SDK state-adapter sweep, which
 * garbage-collects expired rows in chatLocks/chatKv/chatLists/chatQueue
 * every 10 minutes. The hot path for these tables uses lazy TTL on
 * read (`expiresAt > now`), so the cron is purely defensive cleanup —
 * if it skips a beat the read path stays correct.
 */
const crons = cronJobs();

crons.interval(
  "sweep chat-sdk state",
  { minutes: 10 },
  internal.chatState.sweepExpired,
  {},
);

export default crons;
