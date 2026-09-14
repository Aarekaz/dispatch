/**
 * Pure function: filters Slack channel history to plausible candidates
 * for the channel scanner to classify.
 *
 * No IO, no side effects — easy to unit-test with canned arrays.
 */
import type { SlackMessage } from "./slack-api";

const QUESTION_STARTERS = new Set([
  "what",
  "how",
  "when",
  "why",
  "can",
  "does",
  "is",
  "are",
  "who",
  "where",
  "anyone",
  "anybody",
  "has",
  "have",
  "would",
  "could",
  "should",
  "do",
]);

/**
 * Filter Slack messages to those that look like unanswered questions
 * posted by real humans that have gone stale.
 */
export function findCandidates(params: {
  messages: SlackMessage[];
  nowMs: number;
  dwellHours: number;
  botUserId: string;
  alreadyScanned: Set<string>;
  maxCandidates?: number;
}): SlackMessage[] {
  const {
    messages,
    nowMs,
    dwellHours,
    botUserId,
    alreadyScanned,
    maxCandidates = 10,
  } = params;

  const dwellMs = dwellHours * 60 * 60 * 1000;
  const candidates: SlackMessage[] = [];

  for (const msg of messages) {
    if (candidates.length >= maxCandidates) break;

    // Skip bot messages (including our own agent)
    if (msg.bot_id) continue;
    if (msg.user === botUserId) continue;

    // Skip subtypes (join/leave/topic/etc)
    if (msg.subtype) continue;

    // Skip threaded replies (we only want top-level messages)
    if (msg.thread_ts && msg.thread_ts !== msg.ts) continue;

    // Skip if already scanned (dedupe across passes)
    if (alreadyScanned.has(msg.ts)) continue;

    // Skip if too young (hasn't hit the dwell floor)
    const msgAgeMs = nowMs - parseFloat(msg.ts) * 1000;
    if (msgAgeMs < dwellMs) continue;

    // Skip if already answered (has thread replies)
    if (msg.reply_count && msg.reply_count > 0) continue;

    // Skip empty or very short messages
    const text = msg.text?.trim() ?? "";
    if (text.length < 10) continue;

    // Check if it looks like a question
    if (!looksLikeQuestion(text)) continue;

    candidates.push(msg);
  }

  return candidates;
}

/**
 * Heuristic: does this message look like a question?
 * Checks for ? or question-word starters.
 */
function looksLikeQuestion(text: string): boolean {
  if (text.includes("?")) return true;

  const firstWord = text
    .replace(/^<@[A-Z0-9]+>\s*/i, "") // strip leading @mentions
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");

  return firstWord ? QUESTION_STARTERS.has(firstWord) : false;
}
