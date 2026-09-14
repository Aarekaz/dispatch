/**
 * Generates docs/architecture-v2.excalidraw matching V2_ARCHITECTURE.md ASCII diagram.
 * Run: node docs/generate-architecture-excalidraw.mjs
 * (No npm deps — plain JSON compatible with Excalidraw.)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let idx = 0;
const indices = () => `a${idx++}`;

const rnd = () => Math.floor(Math.random() * 1e9);

function rect(id, x, y, w, h, bg = "#f1f3f5") {
  return {
    type: "rectangle",
    id,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: bg,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: { type: 3 },
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    index: indices(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function text(id, x, y, w, h, content, fontSize = 14) {
  return {
    type: "text",
    id,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    index: indices(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    fontSize,
    fontFamily: 1,
    text: content,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: content,
    autoResize: true,
    lineHeight: "1.25000",
  };
}

function arrow(id, x, y, w, h, points) {
  return {
    type: "arrow",
    id,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: rnd(),
    version: 1,
    versionNonce: rnd(),
    index: indices(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    points,
    lastCommittedPoint: points[points.length - 1],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
}

const elements = [];

// --- VERCEL ---
elements.push(rect("r-vercel-outer", 40, 40, 1120, 260, "#e7f5ff"));
elements.push(text("t-vercel-title", 520, 48, 200, 28, "VERCEL (Next.js)", 18));

elements.push(rect("r-fe", 60, 88, 200, 190, "#ffffff"));
elements.push(
  text(
    "t-fe",
    72,
    96,
    176,
    170,
    "Frontend\nChat UI\nDashboard\nSettings",
    14
  )
);

elements.push(rect("r-api", 280, 88, 520, 190, "#ffffff"));
elements.push(
  text(
    "t-api",
    292,
    96,
    496,
    170,
    "/api/agents/[id]/chat\n\n1. Auth+credits\n2. Ensure sandbox running\n3. OpenCode SDK → prompt()\n4. Stream back",
    14
  )
);

elements.push(rect("r-cron", 820, 88, 320, 190, "#ffffff"));
elements.push(text("t-cron", 832, 96, 296, 170, "Crons\n/api/cron/tick", 14));

// FE → API (simple line)
elements.push(
  arrow("a-fe-api", 260, 160, 20, 4, [
    [0, 0],
    [20, 0],
  ])
);

// --- To Daytona ---
elements.push(
  text("t-oc-api", 420, 268, 240, 24, "OpenCode SDK (prompt)", 12)
);
elements.push(
  arrow("a-to-day-1", 540, 292, 4, 28, [
    [0, 0],
    [0, 28],
  ])
);

elements.push(
  text("t-oc-cron", 900, 268, 260, 24, "OpenCode SDK (run/prompt)", 12)
);
elements.push(
  arrow("a-to-day-2", 980, 292, 4, 28, [
    [0, 0],
    [0, 28],
  ])
);

// --- DAYTONA ---
elements.push(rect("r-day-outer", 40, 330, 1120, 620, "#fff4e6"));
elements.push(text("t-day-title", 520, 338, 200, 28, "DAYTONA (per agent)", 18));

elements.push(rect("r-sandbox", 60, 378, 1080, 280, "#ffffff"));
elements.push(
  text(
    "t-sandbox-h",
    72,
    386,
    400,
    24,
    "SANDBOX (starts <100ms, auto-stops after idle)",
    14
  )
);
elements.push(
  text(
    "t-sandbox-body",
    72,
    418,
    1040,
    220,
    "opencode serve --port 4096\n\nBuilt-in tools: bash, read/write/edit, glob/grep, subagent, web_fetch, web_search\n\nOur custom tools (plugins): browser (Browserbase), email (Gmail), calendar (GCal), message (Telegram/Slack), web_fetch, computer (spawn sandbox), memory (volume/Convex)\n\nSessions, compaction, permissions = OpenCode native",
    13
  )
);

elements.push(
  text("t-mounted", 560, 650, 100, 20, "mounted", 12)
);
elements.push(
  arrow("a-mount", 600, 662, 4, 20, [
    [0, 0],
    [0, 20],
  ])
);

elements.push(rect("r-volume", 60, 682, 1080, 200, "#ffffff"));
elements.push(
  text(
    "t-vol-h",
    72,
    690,
    600,
    22,
    "VOLUME (persistent, S3-backed, shared-capable)",
    14
  )
);
elements.push(
  text(
    "t-vol-tree",
    72,
    718,
    1040,
    150,
    "/home/daytona/agent/\n├── workspace/     agent working files\n├── .opencode/     config + sessions (config.json, agents/, plugins/, db/ SQLite)\n├── AGENTS.md      persona / instructions\n└── .env           API keys, secrets",
    12
  )
);

elements.push(
  text(
    "t-extra-h",
    72,
    898,
    1040,
    22,
    "Additional sandboxes (spawned by agent as needed):",
    13
  )
);

elements.push(rect("r-iso", 60, 928, 320, 100, "#ffffff"));
elements.push(
  text("t-iso", 72, 940, 296, 80, "Isolated\ncode exec\n(own volume)", 13)
);

elements.push(rect("r-shared", 400, 928, 360, 100, "#ffffff"));
elements.push(
  text("t-shared", 412, 940, 336, 80, "Shared vol\nbatch job\n(same vol)", 13)
);

elements.push(rect("r-eph", 780, 928, 360, 100, "#ffffff"));
elements.push(
  text("t-eph", 792, 940, 336, 80, "Ephemeral\none-off\n(no volume)", 13)
);

// --- SHARED SERVICES ---
elements.push(rect("r-shared-svc", 40, 980, 1120, 200, "#e6fcf5"));
elements.push(text("t-sh-title", 480, 988, 240, 28, "SHARED SERVICES", 18));

elements.push(rect("r-cx", 60, 1028, 340, 130, "#ffffff"));
elements.push(
  text(
    "t-cx",
    72,
    1036,
    316,
    110,
    "Convex\n• users\n• agents\n• runs/events\n• billing\n• integrations\n• approvals\n• crons",
    13
  )
);

elements.push(rect("r-sdk", 420, 1028, 360, 130, "#ffffff"));
elements.push(
  text(
    "t-sdk",
    432,
    1036,
    336,
    110,
    "Chat SDK\n• Telegram\n• Slack\n• Teams\n• Discord\n• GitHub\n• Linear\n• More adapters",
    13
  )
);

elements.push(rect("r-ext", 800, 1028, 340, 130, "#ffffff"));
elements.push(
  text(
    "t-ext",
    812,
    1036,
    316,
    110,
    "External APIs\n• Browserbase\n• Stripe\n• LLM providers\n• Composio",
    13
  )
);

const doc = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements,
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
};

const out = path.join(__dirname, "architecture-v2.excalidraw");
fs.writeFileSync(out, JSON.stringify(doc, null, 2));
console.log("Wrote", out, "—", elements.length, "elements");
