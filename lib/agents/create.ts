import { Sandbox, Image } from "@daytonaio/sdk";
import { getDaytona } from "@/lib/daytona";
import { renderAgentsMd, renderInitialMemoryMd } from "./render-agents-md";
import { perfTimer } from "@/lib/perf";
import { buildOpenCodeConfig } from "./opencode-config";
import {
  OPENCODE_TOOL_SOURCES,
  OPENCODE_TOOLS_DIR,
} from "@/lib/opencode-tools/tool-sources";
import { basicAuthorization } from "@/lib/security/runtime-auth";

const OPENCODE_PORT = 4096;
const OPENCODE_HOSTNAME = "0.0.0.0";
const OPENCODE_VERSION = "1.14.17";
const OPENCODE_PLUGIN_PACKAGE = "@opencode-ai/plugin";

type SnapshotConflictError = { statusCode?: number };
type DaytonaVolumeState = { state?: string };

/**
 * Snapshot name for sandboxes with OpenCode pre-installed.
 * Created once via `ensureOpenCodeSnapshot()`, reused for all agents.
 * Eliminates the ~30s `npm i -g opencode-ai` on every provisioning.
 *
 * Bumping this constant triggers a one-time snapshot rebuild on the
 * next deploy (the get() in `ensureOpenCodeSnapshot` 404s, the create()
 * path runs). Fresh sandboxes start using the new version immediately.
 * Existing sandboxes keep running whatever was baked into the image
 * they were created from — they're unaffected until recreated.
 *
 * Why 1.14.x: unlocks Custom Tools (`.opencode/tools/*.ts`) + the
 * plugin API (`@opencode-ai/plugin`), which we want for the
 * `announce_artifact` tool and any future agent-visible capabilities
 * that aren't built-in. Kept in lockstep with `@opencode-ai/sdk`
 * (same version across CLI, SDK, plugin) so the host, the runtime,
 * and the in-sandbox plugin helpers agree on event shapes.
 */
// NOTE: Snapshot name follows the Dispatch brand; bump on rebrand or OpenCode upgrade.
// A Daytona snapshot with this name must exist, otherwise agent creation
// fails on first provision. If `ensureOpenCodeSnapshot` 404s, the create
// path runs and publishes the snapshot fresh.
const OPENCODE_SNAPSHOT_NAME = `dispatch-opencode-v${OPENCODE_VERSION}-plugin`;
// Idle timeout before Daytona stops the sandbox. 4 hours (240 min)
// is the sweet spot: long enough to cover a multi-touch workday
// (open the agent in the morning, come back after lunch, both
// sessions hit a warm sandbox), short enough that a truly idle
// agent doesn't burn 24×7 compute. Costs roughly 4-5× a 15-min
// auto-stop, catches >95% of same-day return visits without
// paying the 100s provider cold-init TTFT.
//
// Exported so ensure-running can migrate existing sandboxes on
// their next wake — see TARGET_AUTO_STOP_MINUTES usage there.
export const AUTO_STOP_MINUTES = 240;

/**
 * Inject an environment variable via base64 encoding.
 * From official Daytona OpenCode guide.
 */
function injectEnvVar(name: string, content: string): string {
  const base64 = Buffer.from(content).toString("base64");
  return `${name}=$(echo '${base64}' | base64 -d)`;
}

/**
 * Write the repository's shipped `.opencode/tools/*.ts` files into
 * the sandbox. Idempotent — re-uploading overwrites in place.
 *
 * Called from two paths:
 *
 *   1. `provisionAgent` — initial creation, freshly-mounted volume.
 *      The `.opencode` directory doesn't exist yet, so we create it
 *      (Daytona's `uploadFiles` doesn't auto-create parent dirs).
 *
 *   2. `rebuildAgentOpenCode` in ensure-running.ts — every restart.
 *      Lets us ship new or updated tool files without recreating
 *      agents; the next sandbox boot picks up the current sources.
 *
 * The `createFolder` call is best-effort — it throws if the directory
 * already exists on a restart path, which is fine. We catch+swallow
 * that specific case rather than adding an exists-check round-trip.
 */
export async function syncOpenCodeTools(sandbox: Sandbox): Promise<void> {
  const timer = perfTimer("provision.upload.opencode-tools", {
    count: OPENCODE_TOOL_SOURCES.length,
  });
  if (OPENCODE_TOOL_SOURCES.length === 0) {
    timer.end({ skipped: true });
    return;
  }
  try {
    try {
      await sandbox.fs.createFolder(
        `/home/daytona/agent/${OPENCODE_TOOLS_DIR}`,
        "755",
      );
    } catch {
      // Already exists on restart paths — benign.
    }
    await sandbox.fs.uploadFiles(
      OPENCODE_TOOL_SOURCES.map((t) => ({
        source: Buffer.from(t.source),
        destination: `/home/daytona/agent/${t.path}`,
      })),
    );
    timer.end();
  } catch (err) {
    timer.end({ error: true });
    // Non-fatal: the agent still boots without custom tools. Log
    // loudly so we notice in staging if it ever breaks silently.
    console.warn("[sync-opencode-tools] failed to upload tools:", err);
  }
}

/**
 * Ensure the sandbox's globally-installed `opencode-ai` CLI matches
 * the version we've standardized on. Only needed for LEGACY sandboxes
 * that were provisioned before we bumped the snapshot — they still
 * have whatever CLI was baked into the old image.
 *
 * The guard is a cheap version check rather than unconditionally
 * running `npm i -g` (which is ~20s even when idempotent). We only
 * reinstall when the live version differs.
 *
 * Non-fatal: if the check fails or the install fails, we still
 * proceed with whatever CLI is there. The worst case is that the
 * agent runs an older OpenCode (e.g., without Custom Tools) — the
 * user will see degraded behavior but the sandbox still boots.
 */
export async function ensureOpenCodeCliVersion(
  sandbox: Sandbox,
  targetVersion = OPENCODE_VERSION,
): Promise<void> {
  const timer = perfTimer("ensure-opencode-cli", { target: targetVersion });
  try {
    const [versionCheck, pluginCheck] = await Promise.all([
      sandbox.process.executeCommand(
      "opencode --version 2>/dev/null || echo 'missing'",
      ),
      sandbox.process.executeCommand(
        `node -e "try { const { execSync } = require('child_process'); const root = execSync('npm root -g', { encoding: 'utf8' }).trim(); process.stdout.write(require(root + '/${OPENCODE_PLUGIN_PACKAGE}/package.json').version); } catch { process.stdout.write('missing') }"`,
      ),
    ]);
    const currentCli = (versionCheck.result ?? "").trim();
    const currentPlugin = (pluginCheck.result ?? "").trim();
    if (
      currentCli === targetVersion &&
      currentPlugin === targetVersion
    ) {
      timer.end({
        path: "already-current",
        currentCli,
        currentPlugin,
      });
      return;
    }
    console.log(
      `[ensure-opencode-cli] upgrading cli=${currentCli}, plugin=${currentPlugin} → ${targetVersion}`,
    );
    await sandbox.process.executeCommand(
      `npm i -g opencode-ai@${targetVersion} ${OPENCODE_PLUGIN_PACKAGE}@${targetVersion}`,
    );
    timer.end({
      path: "upgraded",
      fromCli: currentCli,
      fromPlugin: currentPlugin,
      to: targetVersion,
    });
  } catch (err) {
    timer.end({ error: true });
    console.warn("[ensure-opencode-cli] version check/upgrade failed:", err);
  }
}

/**
 * Ensure the OpenCode snapshot exists. Creates it on first call,
 * no-ops on subsequent calls (the snapshot persists across deploys).
 *
 * The snapshot pre-installs `opencode-ai@1.14.17` so new agent
 * provisioning skips the ~30s npm install.
 */
let snapshotReady = false;
async function ensureOpenCodeSnapshot(): Promise<boolean> {
  if (snapshotReady) return true;

  const daytona = getDaytona();
  try {
    const existing = await daytona.snapshot.get(OPENCODE_SNAPSHOT_NAME);
    if (existing) {
      snapshotReady = true;
      return true;
    }
  } catch {
    // Snapshot doesn't exist yet — create it below
  }

  try {
    console.log("[provision] Creating OpenCode snapshot (one-time)...");
    await daytona.snapshot.create(
      {
        name: OPENCODE_SNAPSHOT_NAME,
        image: Image.base("node:20-slim").dockerfileCommands(
          [
            `RUN npm i -g opencode-ai@${OPENCODE_VERSION} ${OPENCODE_PLUGIN_PACKAGE}@${OPENCODE_VERSION}`,
          ],
        ),
      },
      {
        onLogs: (chunk) => console.log("[snapshot]", chunk),
        timeout: 300, // 5 minutes max
      },
    );
    snapshotReady = true;
    console.log("[provision] OpenCode snapshot created");
    return true;
  } catch (err: unknown) {
    // 409 = snapshot already exists — safe to use it
    if (
      err &&
      typeof err === "object" &&
      (err as SnapshotConflictError).statusCode === 409
    ) {
      console.log("[provision] Snapshot already exists, reusing");
      snapshotReady = true;
      return true;
    }
    console.error("[provision] Snapshot creation failed, falling back to npm install:", err);
    return false;
  }
}

/**
 * Provisions a Daytona sandbox + volume for a new agent.
 * Follows the official Daytona + OpenCode SDK pattern exactly:
 * https://www.daytona.io/docs/en/guides/opencode/opencode-sdk-agent/
 */
export async function provisionAgent(config: {
  userId: string;
  slug: string;
  name: string;
  model: string;
  vertical: string;
  persona?: string;
  toolPermissions?: string;
  // Composio toolkit slugs. Accepted in the signature for type symmetry
  // with ensure-running.ts, but NOT injected into the OpenCode config
  // here — at first-boot the agent row in Convex doesn't exist yet, so
  // we don't have a stable `agentId` to bake into the Composio
  // identity `${userId}:${agentId}`. The very first warm-path
  // `ensureAgentRunning` call (fired by the first chat message, once
  // the agent row exists) injects the MCP block correctly. See
  // `resolveComposioMcp` in lib/agents/ensure-running.ts.
  //
  // Templates that want to pre-enable toolkits at create time should
  // provision first, insert the agent row second, then trigger a
  // restart of OpenCode — same shape as the existing model-change
  // PATCH branch.
  composioToolkits?: string[];
  userContext?: {
    company?: string;
    industry?: string;
    background?: string;
    customInstructions?: string;
  };
}): Promise<{
  sandboxId: string;
  volumeId: string;
  serverPassword: string;
}> {
  const totalTimer = perfTimer("provision.total", { slug: config.slug });
  const daytona = getDaytona();
  const serverPassword = crypto.randomUUID();

  // 1. Create persistent volume and wait until ready
  const volumeTimer = perfTimer("provision.volume");
  const volumeName = `agent-${config.userId}-${config.slug}`;
  let volume = await daytona.volume.get(volumeName, true);
  const getVolumeState = (value: unknown) =>
    (value as DaytonaVolumeState | null)?.state;

  const maxWait = 30_000;
  const start = Date.now();
  while (getVolumeState(volume) !== "ready" && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 1000));
    volume = await daytona.volume.get(volumeName);
  }
  if (getVolumeState(volume) !== "ready") {
    throw new Error(`Volume not ready after ${maxWait / 1000}s`);
  }
  volumeTimer.end();

  // 2. Ensure the pre-built snapshot exists (one-time, ~0ms after first call)
  const hasSnapshot = await ensureOpenCodeSnapshot();

  // 3. Create sandbox — from snapshot if available, else default image + npm install
  console.log(`[provision] Creating sandbox (${hasSnapshot ? "from snapshot" : "with npm install"})...`);
  const sandboxTimer = perfTimer("provision.sandbox.create");

  const sandboxOpts = {
    public: true,
    autoStopInterval: AUTO_STOP_MINUTES,
    volumes: [
      { volumeId: volume.id, mountPath: "/home/daytona/agent" },
    ],
    envVars: {
      OPENCODE_HOME: "/home/daytona/agent/.opencode",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
    },
  };

  const sandbox = hasSnapshot
    ? await daytona.create({ ...sandboxOpts, snapshot: OPENCODE_SNAPSHOT_NAME })
    : await daytona.create(sandboxOpts);
  sandboxTimer.end();

  // 3b. If no snapshot, install OpenCode the slow way (fallback)
  if (!hasSnapshot) {
    console.log("[provision] Installing OpenCode (no snapshot fallback)...");
    const installTimer = perfTimer("provision.opencode.install");
    await sandbox.process.executeCommand(
      `npm i -g opencode-ai@${OPENCODE_VERSION} ${OPENCODE_PLUGIN_PACKAGE}@${OPENCODE_VERSION}`,
    );
    installTimer.end();
  }

  // 4. Write AGENTS.md to volume
  const uploadTimer = perfTimer("provision.upload.agents-md");
  const agentsMd = renderAgentsMd({
    name: config.name,
    model: config.model,
    vertical: config.vertical,
    persona: config.persona,
    toolPermissions: config.toolPermissions,
    composioToolkits: config.composioToolkits,
    userContext: config.userContext,
    // No channels connected at provisioning time — AGENTS.md
    // gets regenerated when channels are added via the PATCH route.
  });
  const memoryMd = renderInitialMemoryMd(config.name);
  // Stock .gitignore — many tools (including OpenCode's glob/Search Files
  // tool) honor this when traversing the workspace. Without it, a single
  // `**/*` glob over a Next.js project with node_modules can take minutes
  // through Daytona's slow FUSE. Keep this list conservative — anything
  // here is invisible to glob/search by default.
  const gitignoreContent = [
    "# Dependencies",
    "node_modules/",
    "vendor/",
    ".pnpm-store/",
    ".yarn/",
    "",
    "# Build outputs",
    "dist/",
    "build/",
    "out/",
    ".next/",
    ".turbo/",
    ".cache/",
    "target/",
    "",
    "# Coverage / test",
    "coverage/",
    ".nyc_output/",
    "",
    "# Python",
    "__pycache__/",
    "venv/",
    ".venv/",
    "env/",
    "",
    "# Editor / OS",
    ".DS_Store",
    "Thumbs.db",
    ".vscode/",
    ".idea/",
    "",
    "# Logs",
    "*.log",
    "logs/",
    "",
  ].join("\n");

  await sandbox.fs.createFolder("/home/daytona/agent/workspace", "755");
  await sandbox.fs.createFolder("/home/daytona/agent/memories", "755");
  await sandbox.fs.createFolder("/home/daytona/agent/knowledge", "755");
  await sandbox.fs.uploadFiles([
    {
      source: Buffer.from(agentsMd),
      destination: "/home/daytona/agent/AGENTS.md",
    },
    {
      source: Buffer.from(gitignoreContent),
      destination: "/home/daytona/agent/.gitignore",
    },
    {
      source: Buffer.from(memoryMd),
      destination: "/home/daytona/agent/memories/MEMORY.md",
    },
  ]);
  uploadTimer.end();

  // Upload OpenCode Custom Tools (announce_artifact, etc.) that let
  // the agent emit structured events the web UI can render as
  // clickable artifacts. Idempotent — re-runs on every restart via
  // `syncOpenCodeTools` (see lib/agents/ensure-running.ts).
  await syncOpenCodeTools(sandbox);

  // 5. Build config and start server (official pattern)
  const previewLink = await sandbox.getPreviewLink(1234);
  const previewUrlPattern = previewLink.url.replace(/1234/, "{PORT}");

  const opencodeConfig = buildOpenCodeConfig(previewUrlPattern, {
    name: config.name,
    model: config.model,
    persona: config.persona,
    toolPermissions: config.toolPermissions,
  });

  console.log("[provision] Starting OpenCode server...");
  const serverTimer = perfTimer("provision.opencode.server-start");
  await startOpenCodeServer(sandbox, opencodeConfig, serverPassword);
  serverTimer.end();

  totalTimer.end({ sandboxId: sandbox.id.slice(0, 8) });

  return {
    sandboxId: sandbox.id,
    volumeId: volume.id,
    serverPassword,
  };
}

/**
 * Starts OpenCode server in the sandbox using Daytona process sessions.
 * Exactly matches the official Daytona guide pattern.
 *
 * `extraEnv` lets callers inject additional env vars that the running
 * OpenCode process inherits — notably `SLACK_BOT_TOKEN` so the agent
 * can search Slack history via the `bash` tool (see
 * `lib/chat/slack-secrets.ts`). Each entry is base64-injected the same
 * way `OPENCODE_CONFIG_CONTENT` is, to avoid shell-escape landmines
 * with binary-y values (Slack tokens contain `:` / `-` but that's
 * fine; the base64 wrap is generic).
 */
export async function startOpenCodeServer(
  sandbox: Sandbox,
  opencodeConfig: Record<string, unknown>,
  serverPassword: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  const configJson = JSON.stringify(opencodeConfig);
  const envVars = [
    injectEnvVar("OPENCODE_CONFIG_CONTENT", configJson),
    injectEnvVar("OPENCODE_SERVER_PASSWORD", serverPassword),
  ];
  for (const [name, value] of Object.entries(extraEnv ?? {})) {
    if (value) envVars.push(injectEnvVar(name, value));
  }
  const envPrefix = envVars.join(" ");

  const sessionId = `opencode-serve-${Date.now()}`;
  await sandbox.process.createSession(sessionId);

  const command = await sandbox.process.executeSessionCommand(sessionId, {
    // cd into the mounted volume so tool writes land in persistent storage.
    // Daytona's SessionExecuteRequest has no `cwd` field, so shell `cd` is the
    // canonical way to set the working directory for session commands.
    command: `cd /home/daytona/agent && NODE_PATH=$(npm root -g) ${envPrefix} opencode serve --print-logs --port ${OPENCODE_PORT} --hostname ${OPENCODE_HOSTNAME}`,
    runAsync: true,
  });

  if (!command.cmdId) {
    throw new Error("Failed to start OpenCode server in sandbox");
  }

  // Wait for server to be ready by polling the health endpoint.
  //
  // Important: do NOT attach a live `getSessionCommandLogs(..., onStdout, onStderr)`
  // follower here. That call opens a websocket that stays alive for the
  // lifetime of `opencode serve`, which keeps the surrounding request open
  // indefinitely even after the server is healthy and the caller is ready
  // to continue. A one-shot log fetch is still safe later if we need it for
  // timeout diagnostics, but the synchronous startup path must stay health-only.
  const preview = await sandbox.getPreviewLink(OPENCODE_PORT);
  const healthUrl = `${typeof preview === "string" ? preview : preview.url.replace(/\/$/, "")}/global/health`;

  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(healthPoll);
      resolve();
    };

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(healthPoll);
      reject(new Error("OpenCode server did not start within 60s"));
    }, 60_000);

    // Poll the health endpoint until the proxy sees the server.
    const healthPoll = setInterval(async () => {
      try {
        const res = await fetch(healthUrl, {
          headers: { Authorization: basicAuthorization(serverPassword) },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          console.log("[opencode] Health check passed");
          done();
        }
      } catch {
        // Not ready yet
      }
    }, 2000);
  });
}
