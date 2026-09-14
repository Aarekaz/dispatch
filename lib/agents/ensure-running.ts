import { getDaytona } from "@/lib/daytona";
import {
  AUTO_STOP_MINUTES,
  ensureOpenCodeCliVersion,
  startOpenCodeServer,
  syncOpenCodeTools,
} from "./create";
import { perfLog, perfTimer } from "@/lib/perf";
import {
  getComposioMcpConfig,
  type ComposioMcpConfig,
} from "@/lib/composio/session";
import { getSlackBotTokenForAgent } from "@/lib/chat/slack-secrets";
import {
  buildOpenCodeConfig,
  readSandboxContext,
  type AgentContext,
} from "./opencode-config";
import { basicAuthorization } from "@/lib/security/runtime-auth";

export { agentContextFromRow } from "./opencode-config";

const OPENCODE_PORT = 4096;

/**
 * In-flight promises per sandbox — prevents concurrent start/health-check races.
 * Multiple API routes calling ensureAgentRunning simultaneously will
 * share the same promise instead of each trying to start the sandbox.
 */
const inFlight = new Map<string, Promise<{ previewUrl: string }>>();

/**
 * TTL cache for verified-running sandboxes.
 * Once a sandbox is confirmed healthy, skip re-checking for CACHE_TTL_MS.
 * The greeting page's session fetch warms this on mount, so by the time
 * the user sends a message, the health check is already cached.
 */
const CACHE_TTL_MS = 60_000;
const healthCache = new Map<string, { previewUrl: string; expiresAt: number }>();
type DaytonaSandboxState = { state?: string };

/**
 * Ensures a Daytona sandbox is running and OpenCode server is healthy.
 * Uses a singleton lock per sandboxId to prevent concurrent start races.
 */
export async function ensureAgentRunning(
  sandboxId: string,
  agent?: AgentContext,
): Promise<{
  previewUrl: string;
}> {
  const timer = perfTimer("ensure-running", { sandboxId: sandboxId.slice(0, 8) });

  // Return cached result if still fresh
  const cached = healthCache.get(sandboxId);
  if (cached && Date.now() < cached.expiresAt) {
    timer.end({ path: "cache-hit" });
    return { previewUrl: cached.previewUrl };
  }

  // If another call is already starting this sandbox, wait for it
  const existing = inFlight.get(sandboxId);
  if (existing) {
    const result = await existing;
    timer.end({ path: "inflight-wait" });
    return result;
  }

  const promise = doEnsureRunning(sandboxId, agent);
  inFlight.set(sandboxId, promise);

  try {
    const result = await promise;
    // Cache the successful result
    healthCache.set(sandboxId, {
      previewUrl: result.previewUrl,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    timer.end({ path: "full-check" });
    return result;
  } finally {
    inFlight.delete(sandboxId);
  }
}

/**
 * Resolve the Composio MCP config for a given agent context. Returns
 * `null` when the agent has no toolkits, when identity fields are
 * missing, or when the Composio API call fails (soft-fail). Callers
 * pass the result directly into `buildOpenCodeConfig`.
 */
async function resolveComposioMcp(
  agent: AgentContext | undefined,
): Promise<ComposioMcpConfig | null> {
  if (!agent?.userId || !agent?.agentId) return null;
  const toolkits = agent.composioToolkits ?? [];
  if (toolkits.length === 0) return null;
  return await getComposioMcpConfig({
    userId: agent.userId,
    agentId: agent.agentId,
    toolkits,
  });
}

/**
 * Bust the warm-path health cache for a specific sandbox. Call
 * whenever an agent's runtime-relevant config changes — but note
 * that this alone does NOT trigger a config rebuild. The next
 * `ensureAgentRunning` call that enters `doEnsureRunning` will
 * take the warm-healthy early return if OpenCode is still alive
 * (which it will be after most config changes).
 *
 * For config changes that need a fresh OpenCode boot (e.g. swapping
 * `mcp.composio` when `composioToolkits` changes), call
 * `rebuildAgentOpenCode()` synchronously with full agent context
 * instead. That function kills the running opencode process and
 * reboots it with the new config, then primes the health cache so
 * subsequent calls hit the warm path with the new state.
 */
export function invalidateHealthCache(sandboxId: string | null | undefined): void {
  if (!sandboxId) return;
  healthCache.delete(sandboxId);
}

/**
 * Resolve the sandbox env vars that depend on per-agent state.
 *
 * Currently just `SLACK_BOT_TOKEN` — injected when the agent has a
 * workspace-level Slack binding so its OpenCode process can use the
 * existing Chat SDK bot token to search Slack history via the `bash`
 * tool (see `buildBootstrapPrompt`).
 *
 * Always returns an object — when no token is available the Slack
 * key is absent and `startOpenCodeServer` skips injecting it.
 * Callers should invoke this on every sandbox start so token
 * rotation / new Slack installs are picked up automatically.
 */
async function resolveAgentEnvVars(
  agent?: AgentContext,
): Promise<Record<string, string>> {
  const extra: Record<string, string> = {};
  if (agent?.agentId) {
    const slackToken = await getSlackBotTokenForAgent(agent.agentId);
    if (slackToken) extra.SLACK_BOT_TOKEN = slackToken;
  }
  return extra;
}

/**
 * Synchronously rebuild OpenCode in an already-provisioned sandbox
 * with a fresh config. The caller MUST pass the full agent context
 * — we need `userId`, `agentId`, and `composioToolkits` to resolve
 * the current Composio MCP block correctly.
 *
 * Why this is separate from `ensureAgentRunning`:
 *
 *   - `ensureAgentRunning` is called from 10+ endpoints with varying
 *     amounts of agent context (some pass nothing, some pass name+
 *     model+persona, only the chat route passes full identity).
 *   - When OpenCode is already healthy, `ensureAgentRunning` returns
 *     early without rebuilding the config. That's the right default
 *     for warm calls — they shouldn't thrash the sandbox on every
 *     poll. But it means we can't use it to FORCE a rebuild after
 *     a config change.
 *   - Deferred flags (e.g. "rebuild on next call") are fragile: the
 *     first call that consumes the flag might not have the full
 *     context needed to rebuild correctly, and the config ends up
 *     missing fields (like the Composio MCP block).
 *
 * This function puts the rebuild exactly where the config change
 * happens — the PATCH handler — so there's no ambiguity about which
 * caller triggers it and no risk of consuming a flag with partial
 * context.
 */
export async function rebuildAgentOpenCode(
  sandboxId: string,
  agent: AgentContext & { userId: string; agentId: string },
): Promise<{ previewUrl: string }> {
  const timer = perfTimer("rebuild-opencode", {
    sandboxId: sandboxId.slice(0, 8),
  });

  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);
  const state = (sandbox as { state?: string }).state;

  // If the sandbox is stopped, start it. `sandbox.start` is idempotent
  // but we only call it when needed to avoid paying its latency twice.
  if (state !== "started") {
    await daytona.start(sandbox, 60);
  }

  const preview = await sandbox.getPreviewLink(OPENCODE_PORT);
  const previewUrl =
    typeof preview === "string" ? preview : preview.url.replace(/\/$/, "");

  // 1. Kill any existing opencode process so port 4096 frees before
  //    we spin up the new one. `|| true` swallows the non-zero exit
  //    when no process matches. The sleep gives the OS a beat to
  //    release the socket — without it the new `opencode serve`
  //    can race the old one and fail to bind.
  try {
    await sandbox.process.executeCommand(
      "pkill -f 'opencode serve' || true",
    );
    await new Promise((r) => setTimeout(r, 1500));
  } catch (err) {
    console.warn(
      "[rebuild-opencode] pkill failed (non-fatal, continuing):",
      err,
    );
  }

  // 1b. Upgrade the CLI on legacy sandboxes + sync Custom Tools.
  // Both are no-ops on freshly-provisioned sandboxes (snapshot already
  // has the right CLI version, tools were uploaded during creation).
  // They matter for sandboxes created BEFORE we bumped the snapshot
  // or added `announce_artifact` — the next restart after deploy
  // brings them current without requiring agent recreation.
  await ensureOpenCodeCliVersion(sandbox);
  await syncOpenCodeTools(sandbox);

  // 2. Rebuild config with the fresh Composio MCP snippet and boot.
  const previewUrlPattern = (await sandbox.getPreviewLink(1234)).url.replace(
    /1234/,
    "{PORT}",
  );
  const [composioMcp, sandboxCtx, extraEnv] = await Promise.all([
    resolveComposioMcp(agent),
    readSandboxContext(sandbox),
    resolveAgentEnvVars(agent),
  ]);
  await startOpenCodeServer(
    sandbox,
    buildOpenCodeConfig(previewUrlPattern, agent, composioMcp, sandboxCtx),
    requireRuntimePassword(agent),
    extraEnv,
  );

  // 3. Wait for readiness — same pattern as the resume path.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await checkHealth(previewUrl, requireRuntimePassword(agent))) {
      // Prime the health cache so subsequent `ensureAgentRunning`
      // calls take the warm path against the freshly-rebuilt state.
      healthCache.set(sandboxId, {
        previewUrl,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      timer.end({ attempt, healthy: true });
      console.log("[rebuild-opencode] OpenCode ready after rebuild");
      return { previewUrl };
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  timer.end({ healthy: false });
  console.warn(
    "[rebuild-opencode] OpenCode not healthy after rebuild, proceeding",
  );
  // Still prime the cache — we've done our best, the next chat call
  // will surface any session.error if the new OpenCode is truly broken.
  healthCache.set(sandboxId, {
    previewUrl,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return { previewUrl };
}

async function doEnsureRunning(
  sandboxId: string,
  agent?: AgentContext,
): Promise<{
  previewUrl: string;
}> {
  const daytona = getDaytona();

  const getTimer = perfTimer("ensure-running:daytona.get", { sandboxId: sandboxId.slice(0, 8) });
  const sandbox = await daytona.get(sandboxId);
  const state = (sandbox as DaytonaSandboxState).state;
  getTimer.end({ state });

  // Opportunistic migration: bring existing sandboxes' auto-stop
  // interval up to the current target (see AUTO_STOP_MINUTES in
  // `./create.ts`). Sandboxes provisioned before the target changed
  // keep their old value until Daytona is told otherwise — we catch
  // them here on every ensure-running call. Fire-and-forget so it
  // doesn't add latency to the boot path; a failed migration is
  // harmless (sandbox keeps its old value, we retry next time).
  const currentAutoStop = (sandbox as unknown as {
    autoStopInterval?: number;
  }).autoStopInterval;
  if (
    typeof currentAutoStop === "number" &&
    currentAutoStop !== AUTO_STOP_MINUTES
  ) {
    void (async () => {
      try {
        await (
          sandbox as unknown as {
            setAutostopInterval: (interval: number) => Promise<void>;
          }
        ).setAutostopInterval(AUTO_STOP_MINUTES);
        perfLog("ensure-running:auto-stop.migrated", {
          sandboxId: sandboxId.slice(0, 8),
          from: currentAutoStop,
          to: AUTO_STOP_MINUTES,
        });
      } catch (err) {
        perfLog("ensure-running:auto-stop.migrate-failed", {
          sandboxId: sandboxId.slice(0, 8),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  // Track whether we resumed from a stopped state — if so, OpenCode is
  // guaranteed not to be running, so we skip the health loop and start it directly.
  const wasStopped = state !== "started";

  if (wasStopped) {
    const startTimer = perfTimer("ensure-running:daytona.start", { sandboxId: sandboxId.slice(0, 8), fromState: state });
    await daytona.start(sandbox, 60);
    startTimer.end();
  }

  // Get preview URL for OpenCode
  const linkTimer = perfTimer("ensure-running:getPreviewLink");
  const preview = await sandbox.getPreviewLink(OPENCODE_PORT);
  const previewUrl = typeof preview === "string"
    ? preview
    : preview.url.replace(/\/$/, "");
  linkTimer.end();

  console.log("[ensure-running] Preview URL:", previewUrl);

  // If we just resumed the sandbox, OpenCode is NOT running. Skip the health
  // loop (which would waste ~13s failing 6 times) and start it directly.
  if (wasStopped) {
    const restartTimer = perfTimer("ensure-running:startOpenCodeServer", { reason: "resumed" });
    const previewUrlPattern = (await sandbox.getPreviewLink(1234)).url.replace(/1234/, "{PORT}");
    // Resolve Composio MCP config for this agent's toolkits before
    // rebuilding. Cheap on cache hit; one HTTP on cold. Soft-fails to
    // null so a Composio outage still lets the agent boot.
    const [composioMcp, sandboxCtx, extraEnv] = await Promise.all([
      resolveComposioMcp(agent),
      readSandboxContext(sandbox),
      resolveAgentEnvVars(agent),
    ]);
    await startOpenCodeServer(
      sandbox,
      buildOpenCodeConfig(
        previewUrlPattern,
        agent,
        composioMcp,
        sandboxCtx,
        Boolean(extraEnv.SLACK_BOT_TOKEN),
      ),
      requireRuntimePassword(agent),
      extraEnv,
    );
    restartTimer.end();

    // After resume, wait for OpenCode to be fully ready — not just
    // "listening". The models.dev catalog refresh runs async after the
    // server starts accepting connections. Without this wait, the
    // first prompt races the refresh and fails with session.error.
    // Poll health up to 3 times (same pattern as the warm path).
    const readinessTimer = perfTimer("ensure-running:readiness-after-resume");
    for (let attempt = 1; attempt <= 3; attempt++) {
    if (await checkHealth(previewUrl, requireRuntimePassword(agent))) {
        readinessTimer.end({ attempt, healthy: true });
        console.log("[ensure-running] OpenCode ready after resume");
        // Background sync: filesystem → Convex (fire-and-forget)
        if (agent?.agentId) {
          import("./memory-sync").then(({ trySyncAgentMemory }) =>
            trySyncAgentMemory(agent.agentId!, sandboxId),
          ).catch(() => {});
        }
        return { previewUrl };
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
    readinessTimer.end({ healthy: false });
    // Fall through even if not healthy — better to try and get a
    // clear session.error than to block indefinitely.
    console.warn("[ensure-running] OpenCode not healthy after resume, proceeding anyway");
    return { previewUrl };
  }

  // Sandbox was already running — OpenCode might still be healthy. Check once
  // quickly; if not, fall through to the retry loop and eventual restart.
  const firstCheck = perfTimer("ensure-running:health", { attempt: 1 });
  if (await checkHealth(previewUrl, requireRuntimePassword(agent))) {
    firstCheck.end({ healthy: true });
    console.log("[ensure-running] OpenCode healthy");
    return { previewUrl };
  }
  firstCheck.end({ healthy: false });

  // Sandbox running but OpenCode unhealthy — probably restarting. Give it 2 more tries.
  for (let i = 2; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const healthTimer = perfTimer("ensure-running:health", { attempt: i });
    const healthy = await checkHealth(previewUrl, requireRuntimePassword(agent));
    healthTimer.end({ healthy });
    if (healthy) {
      console.log("[ensure-running] OpenCode healthy");
      return { previewUrl };
    }
  }

  // Still unhealthy after 3 tries — restart OpenCode server
  perfLog("ensure-running:restart-opencode");
  console.log("[ensure-running] OpenCode not healthy, restarting...");

  const restartTimer = perfTimer("ensure-running:startOpenCodeServer", { reason: "unhealthy" });
  const previewUrlPattern = (await sandbox.getPreviewLink(1234)).url.replace(/1234/, "{PORT}");
  const [composioMcp, sandboxCtx, extraEnv] = await Promise.all([
    resolveComposioMcp(agent),
    readSandboxContext(sandbox),
    resolveAgentEnvVars(agent),
  ]);
  await startOpenCodeServer(
    sandbox,
    buildOpenCodeConfig(previewUrlPattern, agent, composioMcp, sandboxCtx),
    requireRuntimePassword(agent),
    extraEnv,
  );
  restartTimer.end();

  return { previewUrl };
}

function requireRuntimePassword(agent: AgentContext | undefined): string {
  if (!agent?.serverPassword) {
    throw new Error("Agent runtime password is required");
  }
  return agent.serverPassword;
}

async function checkHealth(baseUrl: string, serverPassword: string): Promise<boolean> {
  try {
    const healthUrl = `${baseUrl}/global/health`;
    const res = await fetch(healthUrl, {
      headers: { Authorization: basicAuthorization(serverPassword) },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`[ensure-running] Health ${healthUrl} → ${res.status}`);
    return res.ok;
  } catch (err) {
    console.log(`[ensure-running] Health check error:`, (err as Error).message);
    return false;
  }
}
