/**
 * Channel scanner trigger handler.
 *
 * Orchestrates one scan pass for a `slack.channel_scanner` trigger:
 * 1. Fetch recent channel history via native Slack API
 * 2. Filter to candidate messages (pure function)
 * 3. Classify each candidate via Haiku
 * 4. React with :eyes: on relevant messages
 * 5. Invoke the automation for high-confidence candidates
 * 6. Record scan results for dedupe
 *
 * This is the implementation of the Viktor-style ambient agent
 * behavior. The scanner runs on a cron schedule (default every 6h),
 * finds unanswered questions in the channel, and lets the agent
 * jump in to help.
 */
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { invokeAutomation } from "../invoke";
import { fetchChannelHistory, addReaction } from "./slack-api";
import { findCandidates } from "./candidate-finder";
import { classifyCandidate } from "./classifier";

function getInternalSecret(): string {
  return process.env.CRON_INTERNAL_SECRET ?? "";
}
function getChatStateSecret(): string {
  return process.env.CHAT_STATE_INTERNAL_SECRET ?? "";
}

const MAX_REPLIES_PER_SCAN = 3;
const MAX_REACTIONS_PER_SCAN = 10;

export type ScanPassResult = {
  candidates: number;
  reacted: number;
  responded: number;
  skipped: number;
  errors: number;
};

export type ScannerTriggerConfig = {
  teamId: string;
  channelId: string;
  channelName?: string;
  cadenceHours: number;
  dwellHours: number;
  classifierThreshold: number;
};

/**
 * Run one scan pass for a channel scanner trigger.
 */
export async function runScanPass(params: {
  automation: {
    _id: string;
    agentId: string;
    name: string;
    instructions: string;
    composioToolkits?: string[];
  };
  trigger: {
    id: string;
    config: ScannerTriggerConfig;
  };
  agent: {
    name: string;
    persona?: string;
    composioToolkits?: string[];
  };
  lastScanAt?: number;
}): Promise<ScanPassResult> {
  const { automation, trigger, agent, lastScanAt } = params;
  const config = trigger.config;
  const result: ScanPassResult = {
    candidates: 0,
    reacted: 0,
    responded: 0,
    skipped: 0,
    errors: 0,
  };

  // 1. Get the Slack bot token + bot user ID (single fetch)
  const install = await getSlackInstallation(config.teamId);
  if (!install) {
    console.error(
      `[scanner] no bot token for team=${config.teamId} automation=${automation._id}`,
    );
    return result;
  }
  const { botToken: token, botUserId } = install;

  // 2. Fetch channel history
  const nowMs = Date.now();
  const cadenceMs = config.cadenceHours * 60 * 60 * 1000;
  const bufferMs = 15 * 60 * 1000; // 15 min safety buffer

  // History window: go back to whichever is earlier —
  // the cadence window OR the last scan time (with buffer).
  // This ensures late-running scans don't drop coverage.
  const defaultOldest = nowMs - cadenceMs;
  const lastScanOldest = lastScanAt
    ? lastScanAt - bufferMs
    : nowMs - 12 * 60 * 60 * 1000; // 12h bootstrap on first scan
  const oldestMs = Math.min(defaultOldest, lastScanOldest);
  const oldestSec = oldestMs / 1000;

  const historyResult = await fetchChannelHistory(
    token,
    config.channelId,
    oldestSec,
    200,
  );
  if (!historyResult.ok) {
    const detail =
      historyResult.error.kind === "rate_limited"
        ? historyResult.error.retryAfterSec
        : "detail" in historyResult.error
          ? historyResult.error.detail
          : undefined;
    console.error(
      `[scanner] history fetch failed channel=${config.channelId} error=${historyResult.error.kind}:${detail ?? "unknown"}`,
    );
    return result;
  }

  // 3. Get already-scanned message timestamps for dedupe
  // Uses the secret-gated listInternal (not the auth-gated list)
  // because the scanner runs from the cron dispatcher with no user auth.
  const recentScans = await fetchQuery(api.agentAutomationRuns.listInternal, {
    automationId: automation._id as Id<"agentAutomations">,
    limit: 50,
    secret: getInternalSecret(),
  }).catch((err) => {
    console.error("[scanner] dedupe query failed:", err);
    return [];
  });

  const alreadyScanned = new Set(
    (recentScans as Array<{ triggerDetail?: string }>)
      .map((r) => r.triggerDetail?.replace(/^scan:/, ""))
      .filter(Boolean) as string[],
  );

  // 4. Filter to candidates
  const candidates = findCandidates({
    messages: historyResult.value,
    nowMs,
    dwellHours: config.dwellHours,
    botUserId: botUserId ?? "",
    alreadyScanned,
  });
  result.candidates = candidates.length;

  if (candidates.length === 0) {
    console.log(
      `[scanner] no candidates channel=${config.channelId} messages_checked=${historyResult.value.length}`,
    );
    return result;
  }

  // 5. Build context for the classifier
  const recentMessages = historyResult.value
    .slice(0, 10)
    .map((m) => `@${m.user ?? "unknown"}: ${m.text ?? ""}`)
    .join("\n");

  const capabilities = agent.composioToolkits ?? [];

  // 6. Classify all candidates in parallel (3 concurrent max),
  // then act on results sequentially to respect rate limits.
  const classificationResults = await Promise.allSettled(
    candidates.map((candidate) =>
      classifyCandidate({
        agent: { name: agent.name, persona: agent.persona, capabilities },
        channelName: config.channelName ?? config.channelId,
        recentContext: recentMessages,
        candidate: {
          text: candidate.text ?? "",
          user: candidate.user ?? "unknown",
          ts: candidate.ts,
        },
      }).then((classification) => ({ candidate, classification })),
    ),
  );

  let repliesBudget = MAX_REPLIES_PER_SCAN;
  let reactionsBudget = MAX_REACTIONS_PER_SCAN;

  for (const settled of classificationResults) {
    if (settled.status === "rejected") {
      result.errors++;
      continue;
    }

    const { candidate, classification } = settled.value;

    if (reactionsBudget <= 0) {
      result.skipped++;
      continue;
    }

    try {
      if (classification.verdict === "skip") {
        result.skipped++;
        await fetchMutation(api.agentAutomationRuns.log, {
          automationId: automation._id as Id<"agentAutomations">,
          agentId: automation.agentId as Id<"agents">,
          status: "skipped",
          triggerKind: "trigger",
          triggerDetail: `scan:${candidate.ts}`,
          summary: `Skipped: ${classification.reason}`,
          secret: getInternalSecret(),
        }).catch((e) => console.warn("[scanner] non-critical mutation failed:", e));
        continue;
      }

      // React with :eyes:
      if (reactionsBudget > 0) {
        await addReaction(token, config.channelId, candidate.ts, "eyes");
        reactionsBudget--;
        result.reacted++;
      }

      if (classification.verdict === "respond" && repliesBudget > 0) {
        const ageHours = Math.round(
          (nowMs - parseFloat(candidate.ts) * 1000) / (1000 * 60 * 60),
        );
        const contextMessage = [
          `The following question was posted in #${config.channelName ?? config.channelId} by @${candidate.user ?? "unknown"} and has gone unanswered for ${ageHours} hours:`,
          "",
          `"${candidate.text}"`,
          "",
          "Respond helpfully based on your tools and knowledge.",
        ].join("\n");

        await invokeAutomation({
          automationId: automation._id,
          agentId: String(automation.agentId),
          triggerKind: "trigger",
          triggerDetail: `scan:${candidate.ts}`,
          contextMessage,
          deliveryOverride: {
            type: "slack_thread",
            config: {
              teamId: config.teamId,
              channelId: config.channelId,
              threadTs: candidate.ts,
            },
          },
        });

        repliesBudget--;
        result.responded++;
      } else if (classification.verdict === "react_only") {
        await fetchMutation(api.agentAutomationRuns.log, {
          automationId: automation._id as Id<"agentAutomations">,
          agentId: automation.agentId as Id<"agents">,
          status: "success",
          triggerKind: "trigger",
          triggerDetail: `scan:${candidate.ts}`,
          summary: `Reacted only: ${classification.reason}`,
          secret: getInternalSecret(),
        }).catch((e) => console.warn("[scanner] non-critical mutation failed:", e));
      }
    } catch (err) {
      console.error(`[scanner] candidate error ts=${candidate.ts}:`, err);
      result.errors++;
    }
  }

  // 7. Update scanner bookkeeping
  await fetchMutation(api.agentAutomations.markScannerRun, {
    id: automation._id as Id<"agentAutomations">,
    triggerId: trigger.id,
    lastScanAt: nowMs,
    secret: getInternalSecret(),
  }).catch((err) => {
    console.error("[scanner] markScannerRun failed:", err);
  });

  console.log(
    `[scanner] channel=${config.channelId} candidates=${result.candidates} reacted=${result.reacted} responded=${result.responded} skipped=${result.skipped} errors=${result.errors}`,
  );

  return result;
}

// ── Helpers ──────────────────────────────────────────────

async function getSlackInstallation(
  teamId: string,
): Promise<{ botToken: string; botUserId: string } | null> {
  try {
    const result = await fetchQuery(api.chatState.get, {
      key: `slack:installation:${teamId}`,
      secret: getChatStateSecret(),
    });
    if (!result?.value) return null;
    const install = result.value as {
      botToken?: string;
      botUserId?: string;
    };
    if (!install.botToken) return null;
    return {
      botToken: install.botToken,
      botUserId: install.botUserId ?? "",
    };
  } catch {
    return null;
  }
}
