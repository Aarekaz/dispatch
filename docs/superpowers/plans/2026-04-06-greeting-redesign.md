# Agent Greeting Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline ThreadWelcome with a two-view architecture: centered greeting screen (plain input) that transitions to assistant-ui chat on first message.

**Architecture:** Greeting view and chat view are separate component trees inside `AgentChat`. The greeting has its own HTML input (not ComposerPrimitive). On submit, a session is created and `ChatThread` mounts with an `AutoSendMessage` child that calls `runtime.thread.append()` to trigger the first API call. `AgentAvatar` is a standalone reusable component.

**Tech Stack:** Next.js, Tailwind v4, assistant-ui, next/font/google (Newsreader serif)

**Spec:** `docs/superpowers/specs/2026-04-06-greeting-redesign-design.md`

---

### Task 1: Design Tokens (font, keyframes, utilities)

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add Newsreader font to layout.tsx**

```tsx
// app/layout.tsx — add import and variable
import { Newsreader } from "next/font/google";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["300", "400", "500"],
  display: "swap",
});

// In the html tag, add the variable:
<html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`}>
```

- [ ] **Step 2: Add font-serif to theme in globals.css**

In the `@theme inline` block, add after `--font-mono`:

```css
--font-serif: var(--font-newsreader), Georgia, serif;
```

- [ ] **Step 3: Add blob animation keyframes to globals.css**

Append after the existing `@layer base` blocks (after the transition defaults section at the end of the file):

```css
/* ── Blob avatar animations ─────────────── */

@keyframes siriBlob1 {
  0%   { transform: translate(-25%, -20%) scale(1); }
  33%  { transform: translate(15%, -25%) scale(1.15); }
  66%  { transform: translate(25%, 15%) scale(0.9); }
  100% { transform: translate(-10%, 20%) scale(1.1); }
}

@keyframes siriBlob2 {
  0%   { transform: translate(25%, -15%) scale(1.1); }
  33%  { transform: translate(-20%, 20%) scale(0.85); }
  66%  { transform: translate(-15%, -25%) scale(1.15); }
  100% { transform: translate(20%, 10%) scale(1); }
}

@keyframes siriBlob3 {
  0%   { transform: translate(10%, 25%) scale(0.9); }
  33%  { transform: translate(20%, -20%) scale(1.15); }
  66%  { transform: translate(-25%, 10%) scale(1); }
  100% { transform: translate(-15%, -15%) scale(1.1); }
}

@keyframes siriBlob4 {
  0%   { transform: translate(-15%, 10%) scale(1.15); }
  33%  { transform: translate(25%, 15%) scale(0.9); }
  66%  { transform: translate(-10%, -20%) scale(1.1); }
  100% { transform: translate(15%, 25%) scale(1); }
}

@keyframes siriPulse {
  0%   { opacity: 0.4; transform: scale(0.7); }
  50%  { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0.4; transform: scale(0.7); }
}

@keyframes greetingEnter {
  from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
  to   { opacity: 1; transform: translateY(0); filter: blur(0); }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes siriBlob1 { 0%, 100% { transform: none; } }
  @keyframes siriBlob2 { 0%, 100% { transform: none; } }
  @keyframes siriBlob3 { 0%, 100% { transform: none; } }
  @keyframes siriBlob4 { 0%, 100% { transform: none; } }
  @keyframes siriPulse { 0%, 100% { opacity: 0.7; transform: scale(1); } }
  @keyframes greetingEnter { 0%, 100% { opacity: 1; transform: none; filter: none; } }
}
```

- [ ] **Step 4: Add greeting utilities to globals.css**

Append after the keyframes:

```css
/* ── Greeting utilities ─────────────────── */

@utility dot-grid {
  position: absolute;
  inset: 0;
  opacity: 0.035;
  background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
  background-size: 16px 16px;
  mask-image: linear-gradient(to bottom, black 30%, transparent 75%);
  -webkit-mask-image: linear-gradient(to bottom, black 30%, transparent 75%);
  pointer-events: none;
}

@utility greeting-enter {
  animation: greetingEnter 600ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add design tokens for greeting redesign (serif font, blob keyframes, utilities)"
```

---

### Task 2: AgentAvatar Component

**Files:**
- Create: `components/agent-avatar.tsx`

- [ ] **Step 1: Create the AgentAvatar component**

```tsx
// components/agent-avatar.tsx
"use client";

const THEMES = {
  gray: {
    bg: "#1a1a1a",
    blobs: ["#a3a3a3", "#d4d4d4", "#737373", "#e5e5e5"],
  },
  aurora: {
    bg: "#0c0414",
    blobs: ["#FF2D87", "#00C9FF", "#7B61FF", "#FF6B9D"],
  },
  ocean: {
    bg: "#060E1F",
    blobs: ["#38bdf8", "#818cf8", "#06b6d4", "#6366f1"],
  },
  emerald: {
    bg: "#04120C",
    blobs: ["#10b981", "#059669", "#34d399", "#047857"],
  },
  sunset: {
    bg: "#140804",
    blobs: ["#f97316", "#ef4444", "#eab308", "#dc2626"],
  },
  violet: {
    bg: "#0E0418",
    blobs: ["#a855f7", "#ec4899", "#8b5cf6", "#d946ef"],
  },
} as const;

export type AvatarTheme = keyof typeof THEMES;

const BLOB_ANIMATIONS = [
  "siriBlob1 3s ease-in-out infinite alternate",
  "siriBlob2 3.8s ease-in-out infinite alternate",
  "siriBlob3 4.6s ease-in-out infinite alternate",
  "siriBlob4 5.4s ease-in-out infinite alternate",
];

const SIZES = {
  xs: { box: 24, blur: 3, text: "text-[9px]" },
  sm: { box: 32, blur: 4, text: "text-[11px]" },
  md: { box: 40, blur: 5, text: "text-[13px]" },
  lg: { box: 56, blur: 6, text: "text-[18px]" },
  xl: { box: 80, blur: 8, text: "text-[24px]" },
} as const;

/** Hash a string to pick a theme deterministically. */
function hashTheme(name: string): AvatarTheme {
  const keys = Object.keys(THEMES) as AvatarTheme[];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return keys[Math.abs(hash) % keys.length];
}

export function AgentAvatar({
  name,
  size = "md",
  theme,
}: {
  name: string;
  size?: keyof typeof SIZES;
  theme?: AvatarTheme;
}) {
  const resolvedTheme = theme ?? hashTheme(name);
  const { bg, blobs } = THEMES[resolvedTheme];
  const { box, blur, text } = SIZES[size];
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full ring-1 ring-white/10"
      style={{ width: box, height: box }}
    >
      {/* Background */}
      <div className="absolute inset-0" style={{ background: bg }} />

      {/* Animated blobs */}
      {blobs.map((color, i) => (
        <div
          key={i}
          className="absolute mix-blend-screen"
          style={{
            width: "120%",
            height: "120%",
            top: "-10%",
            left: "-10%",
            borderRadius: "50%",
            background: `radial-gradient(circle at 50% 50%, ${color} 0%, ${color}88 30%, transparent 65%)`,
            opacity: 0.9,
            animation: BLOB_ANIMATIONS[i],
            filter: `blur(${blur}px)`,
          }}
        />
      ))}

      {/* Shine */}
      <div
        className="absolute"
        style={{
          top: "15%",
          left: "20%",
          width: "45%",
          height: "45%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.3) 40%, transparent 70%)",
          animation: "siriPulse 3s ease-in-out infinite alternate",
        }}
      />

      {/* Initial letter */}
      <div
        className={`absolute inset-0 z-10 flex items-center justify-center font-medium text-white ${text}`}
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
      >
        {initial}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agent-avatar.tsx
git commit -m "feat: add AgentAvatar component with animated gradient blobs"
```

---

### Task 3: AgentGreeting Component

**Files:**
- Create: `components/agent-greeting.tsx`

- [ ] **Step 1: Create the AgentGreeting component**

```tsx
// components/agent-greeting.tsx
"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { AgentAvatar, type AvatarTheme } from "@/components/agent-avatar";
import { ArrowUpIcon } from "lucide-react";

const DEFAULT_SUGGESTIONS = [
  "Help me build something",
  "Research a topic",
  "Write some code",
  "Create a website",
];

export function AgentGreeting({
  agentName,
  agentTheme,
  suggestions = DEFAULT_SUGGESTIONS,
  onSend,
}: {
  agentName: string;
  agentTheme?: AvatarTheme;
  suggestions?: string[];
  onSend: (message: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSuggestion(text: string) {
    onSend(text);
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 px-4">
      {/* Dot grid background */}
      <div className="dot-grid" />

      {/* Avatar */}
      <div
        className="greeting-enter relative"
        style={{ animationDelay: "0ms" }}
      >
        <AgentAvatar name={agentName} size="lg" theme={agentTheme} />
      </div>

      {/* Hero text */}
      <div
        className="greeting-enter relative text-center"
        style={{ animationDelay: "80ms" }}
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          {agentName}
        </p>
        <h1 className="mt-1 font-serif text-[28px] font-normal leading-tight tracking-tight text-foreground">
          Let&apos;s get started
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          What would you like to build today?
        </p>
      </div>

      {/* Composer */}
      <div
        className="greeting-enter relative w-full max-w-[540px]"
        style={{ animationDelay: "160ms" }}
      >
        <div className="flex w-full items-center gap-2 rounded-[20px] border border-border/60 bg-background p-3 shadow-[0_0_0_0.7px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.03),0_2px_2px_rgba(0,0,0,0.02),0_1px_5px_rgba(0,0,0,0.05)] transition-shadow duration-200 focus-within:shadow-[0_0_0_0.7px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),0_2px_4px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_0.7px_rgba(255,255,255,0.06),0_1px_1px_rgba(0,0,0,0.2),0_2px_2px_rgba(0,0,0,0.15),0_1px_5px_rgba(0,0,0,0.25)]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Assign a task or ask anything..."
            rows={1}
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            autoFocus
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Suggestion pills */}
      <div
        className="greeting-enter relative flex max-w-[540px] flex-wrap justify-center gap-2"
        style={{ animationDelay: "240ms" }}
      >
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => handleSuggestion(text)}
            className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agent-greeting.tsx
git commit -m "feat: add AgentGreeting component with centered layout, plain input, suggestion pills"
```

---

### Task 4: Wire Greeting into AgentChat

**Files:**
- Modify: `components/agent-chat.tsx`
- Modify: `components/assistant-ui/thread.tsx`

- [ ] **Step 1: Remove ThreadWelcome from thread.tsx**

In `components/assistant-ui/thread.tsx`, remove the `ThreadWelcome` component and its usage. The `Thread` component's viewport should no longer render the welcome screen:

Remove the `AuiIf` block that renders `ThreadWelcome` (lines 54-56):
```tsx
// REMOVE these lines from the Thread component:
<AuiIf condition={(s) => s.thread.isEmpty}>
  <ThreadWelcome />
</AuiIf>
```

Remove the entire `ThreadWelcome` component (the function and its `SUGGESTIONS` constant).

Remove `useAgentContext` import if it's only used by `ThreadWelcome`.

Remove `SuggestionPrimitive` from the import if unused after removal.

- [ ] **Step 2: Add greeting view logic to agent-chat.tsx**

Replace the content of `components/agent-chat.tsx` with the updated version. Key changes:

1. Add `AgentGreeting` import
2. Add `pendingMessage` state
3. Add `handleFirstMessage` function that creates a session and sets the pending message
4. Render `AgentGreeting` when no active session exists and no pending message
5. Pass `pendingMessage` to `ChatThread`
6. Add `AutoSendMessage` component inside the runtime provider

```tsx
// At the top of agent-chat.tsx, add import:
import { AgentGreeting } from "@/components/agent-greeting";
import { useAssistantRuntime } from "@assistant-ui/react";
```

In the `AgentChat` component, add state for pending message:
```tsx
const [pendingMessage, setPendingMessage] = useState<string | null>(null);
```

Add the handler for first message from greeting:
```tsx
async function handleFirstMessage(message: string) {
  setPendingMessage(message);
  try {
    const res = await fetch(`/api/agents/${agentId}/sessions/create`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.sessionId) {
      setActiveSessionId(data.sessionId);
    }
  } catch {
    // Session will be created server-side by chat API as fallback
    setActiveSessionId(null);
  }
  setInitialMessages([]);
  setThreadKey((k) => k + 1);
  setTimeout(loadSessions, 3000);
}
```

Determine whether to show greeting:
```tsx
const showGreeting = !activeSessionId && !pendingMessage;
```

In the render, conditionally show greeting or chat:
```tsx
<div className="min-h-0 min-w-0 flex-1">
  <AgentContext.Provider value={agentContextValue}>
    {showGreeting ? (
      <AgentGreeting
        agentName={agentName}
        onSend={handleFirstMessage}
      />
    ) : (
      <ChatThread
        key={threadKey}
        agentId={agentId}
        sessionId={activeSessionId}
        initialMessages={initialMessages}
        onPortDetected={onPortDetected}
        pendingMessage={pendingMessage}
        onMessageSent={() => setPendingMessage(null)}
      />
    )}
  </AgentContext.Provider>
</div>
```

- [ ] **Step 3: Add AutoSendMessage to ChatThread**

In the `ChatThread` component, accept the new props and add `AutoSendMessage`:

```tsx
function ChatThread({
  agentId,
  sessionId,
  initialMessages,
  onPortDetected,
  pendingMessage,
  onMessageSent,
}: {
  agentId: string;
  sessionId: string | null;
  initialMessages: UIMessage[];
  onPortDetected?: (port: string) => void;
  pendingMessage?: string | null;
  onMessageSent?: () => void;
}) {
  // ... existing transport/runtime code ...

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {pendingMessage && (
        <AutoSendMessage message={pendingMessage} onSent={onMessageSent} />
      )}
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

Add the `AutoSendMessage` component at the bottom of the file:

```tsx
/**
 * Sends a message via the runtime on mount.
 * Used to forward the greeting input's message into the assistant-ui thread.
 */
function AutoSendMessage({
  message,
  onSent,
}: {
  message: string;
  onSent?: () => void;
}) {
  const runtime = useAssistantRuntime();
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current || !message) return;
    sentRef.current = true;
    runtime.thread.append(message);
    onSent?.();
  }, [message, runtime, onSent]);

  return null;
}
```

- [ ] **Step 4: Update newThread to show greeting**

In the `newThread` function in `AgentChat`, instead of creating a session immediately, just reset to greeting state:

```tsx
async function newThread() {
  setActiveSessionId(null);
  setPendingMessage(null);
  setInitialMessages([]);
  setThreadKey((k) => k + 1);
}
```

This shows the greeting screen. The session is created when the user actually sends a message.

- [ ] **Step 5: Commit**

```bash
git add components/agent-chat.tsx components/assistant-ui/thread.tsx
git commit -m "feat: two-view greeting/chat architecture with AutoSendMessage"
```

---

### Task 5: Update Sidebar with Blob Avatars

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Replace emoji avatars with AgentAvatar in sidebar**

In `components/app-sidebar.tsx`, add the import:
```tsx
import { AgentAvatar } from "@/components/agent-avatar";
```

Find where agent items are rendered in the sidebar (the agent list section with emoji or initial avatars). Replace the emoji/initial rendering with:

```tsx
<AgentAvatar name={agent.name} size="xs" />
```

This replaces the current pattern of showing `agent.emoji` or a letter initial in a colored box. The `AgentAvatar` handles the initial letter internally.

- [ ] **Step 2: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "feat: replace emoji avatars with animated blob avatars in sidebar"
```

---

### Task 6: Verify & Polish

- [ ] **Step 1: Start dev server and test the full flow**

```bash
npx next dev --turbopack
```

Test checklist:
1. Open an agent page with no session — greeting should appear (blob avatar, serif text, pills)
2. Type a message and hit Enter — should transition to chat, message sent
3. Click a suggestion pill — should transition to chat with that message
4. Click "New chat" in sidebar — should return to greeting
5. Click an existing session in sidebar — should skip greeting, go to chat
6. Check sidebar shows blob avatars for all agents
7. Check dark mode
8. Check `prefers-reduced-motion` (in browser DevTools)

- [ ] **Step 2: Fix any issues found during testing**

- [ ] **Step 3: Final commit if any polish changes were made**

```bash
git add -A
git commit -m "fix: greeting screen polish and edge cases"
```
