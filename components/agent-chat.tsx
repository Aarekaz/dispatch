"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useSound } from "@web-kits/audio/react";

import { AgentChat as AgentChatUI } from "@/components/agent-elements/agent-chat";
import {
  ToolRendererDebug,
  ToolMessageMapContext,
} from "@/components/chat/tool-renderer-debug";
import { ExportTraceButton } from "@/components/chat/export-trace-button";
import { transformReasoningParts } from "@/components/chat/transform-reasoning-parts";

import { MESSAGE_ARRIVED } from "@/lib/sounds";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentGreeting } from "@/components/agent-greeting";
import { AgentContext } from "@/components/agent-context";
import { ArtifactPanel } from "@/components/artifact-panel";
import { ChatWithRightPanel } from "@/components/chat/right-panel";
import { useRightPanel } from "@/components/chat/right-panel-store";
import { useMountEffect, useStrictMountEffect } from "@/hooks/use-mount-effect";
import {
  HIDDEN_TOOLS,
  resolveToolName,
  resolveToolType,
  enrichArgsWithPath,
} from "@/lib/tools/normalize";
import {
  adaptOpenCodeToolInput,
  adaptOpenCodeToolOutput,
} from "@/lib/tools/adapters/opencode-to-agent-elements";
import { Spinner } from "@/components/ui/unicode-spinner";
import { perfLog, perfTimer } from "@/lib/perf";

type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  isAutomation?: boolean;
};

type UIMessagePart = NonNullable<UIMessage["parts"]>[number];

type PersistedToolCallPart = {
  type: "tool-call";
  toolName: string;
  toolCallId?: string;
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  metadata?: Record<string, unknown>;
};

type PersistedTextPart = {
  type: "text" | "reasoning";
  text: string;
};

type PersistedMessagePart = PersistedTextPart | PersistedToolCallPart;

type PersistedSessionMessage = {
  id?: string;
  role?: "user" | "assistant";
  content?: string;
  parts?: PersistedMessagePart[];
};

const DAYTONA_URL_REGEX = /https?:\/\/(\d+)-[a-z0-9-]+\.daytonaproxy\d*\.net/g;

function formatSessionDate(ts: string | number): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Convert a server session payload into UIMessage[] shaped for the
 * agent-elements MessageList: text/reasoning stay as text-ish parts,
 * tool calls become `tool-${ResolvedName}` parts so the registry
 * can route them to specialized renderers (Bash, Edit, Search, …)
 * with a generic fallback.
 */
function historyToUIMessages(data: unknown[]): UIMessage[] {
  return data.map((rawMessage) => {
    const message = rawMessage as PersistedSessionMessage;
    const parts: UIMessage["parts"] = [];

    if (Array.isArray(message.parts)) {
      for (const p of message.parts) {
        if (p.type === "text" && p.text) {
          parts.push({ type: "text", text: p.text } as UIMessagePart);
        } else if (p.type === "reasoning" && p.text) {
          // Emit a real reasoning UIMessage part. `state: "done"`
          // signals to `transformReasoningParts` that this is a
          // finished thought — it gets rewritten to a `tool-Thinking`
          // part with state `output-available` so agent-elements'
          // ThinkingTool renders it as a "Thought" card.
          parts.push({
            type: "reasoning",
            text: p.text,
            state: "done",
          } as UIMessagePart);
        } else if (p.type === "tool-call" && !HIDDEN_TOOLS.has(p.toolName)) {
          // Match the agent-elements registry: part.type drives the
          // dispatch (tool-Bash → BashTool, tool-Edit → EditTool, …).
          // The friendly label rides along on `title` for renderers
          // that surface it (Task subagent label, etc.).
          const registryType = resolveToolType(p.toolName);
          const displayTitle = resolveToolName(p.toolName, p.title);
          const enrichedInput = enrichArgsWithPath(
            p.input ?? {},
            p.title,
            p.output,
          );
          // Same OpenCode → Claude Agent SDK reshape as the live bridge
          // (lib/runtime/ai-sdk-bridge.ts) so persisted history and
          // live streams render identically.
          const adaptedInput = adaptOpenCodeToolInput(p.toolName, enrichedInput);
          const reshapedOutput = adaptOpenCodeToolOutput(
            p.toolName,
            adaptedInput,
            p.output,
            p.metadata,
          );
          parts.push({
            type: `tool-${registryType}`,
            toolCallId: p.toolCallId || `tool-${Math.random().toString(36).slice(2)}`,
            state: "output-available",
            title: displayTitle,
            input: adaptedInput,
            output: reshapedOutput,
          } as UIMessagePart);
        }
      }
    }

    if (parts.length === 0 && message.content) {
      parts.push({ type: "text", text: message.content } as UIMessagePart);
    }

    return {
      id: message.id || `msg-${Math.random().toString(36).slice(2)}`,
      role: message.role ?? "assistant",
      parts,
    } as UIMessage;
  });
}

function isTextUIMessagePart(part: unknown): part is { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  );
}

/**
 * Full chat interface — session list + greeting + agent-elements chat.
 *
 * Migrated from @assistant-ui/react to @21st-dev/agent-elements: messages
 * flow through the AI SDK `useChat` hook directly, and rendering is
 * delegated to the agent-elements `<AgentChat>` primitive (MessageList +
 * InputBar + the built-in tool registry / generic fallback).
 */
export function AgentChat({
  agentId,
  agentName = "",
  agentEmoji,
  agentVertical = "",
  initialSessionId,
  autoSendMessage,
  greetingHeroSlot,
  greetingBottomSlot,
  onSessionChange,
  showArtifacts,
  onCloseArtifacts,
  onPortDetected,
  detectedPort,
  onOpenFile,
}: {
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  agentVertical?: string;
  initialSessionId?: string | null;
  autoSendMessage?: string | null;
  greetingHeroSlot?: React.ReactNode;
  greetingBottomSlot?: React.ReactNode;
  onSessionChange?: (sessionId: string | null) => void;
  showArtifacts?: boolean;
  onCloseArtifacts?: () => void;
  onPortDetected?: (port: string) => void;
  detectedPort?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  // Session list from Convex (reactive — updates instantly when new
  // sessions are created, including automation-triggered ones).
  // Skip the query for non-Convex ids so the validator doesn't throw before
  // the layout's 404 guard kicks in.
  const convexSessions = useQuery(
    api.sessions.list,
    /^[a-z0-9]{32}$/.test(agentId)
      ? { agentId: agentId as Id<"agents"> }
      : "skip",
  );
  const sessions: SessionItem[] = useMemo(
    () =>
      (convexSessions ?? []).map((s) => ({
        id: s.sessionExternalId,
        title: s.title || `Session ${s.sessionExternalId.slice(-8)}`,
        updatedAt: s.updatedAt ? formatSessionDate(s.updatedAt) : "",
        isAutomation: !!s.automationId,
      })),
    [convexSessions],
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  // Force ChatThread remount when switching sessions so useChat re-seeds
  // from `initialMessages` and the transport rebinds with the new sid.
  const [threadKey, setThreadKey] = useState(0);

  const loadSessions = useCallback(() => {
    // Convex useQuery handles reactivity; kept as a no-op for callers
    // that signal "session list may have changed."
  }, []);

  useMountEffect(() => {
    loadSessions();
    if (autoSendMessage && !initialSessionId) {
      handleFirstMessage(autoSendMessage);
    }
  });

  const selectSession = useCallback(async function selectSession(sessionId: string) {
    const timer = perfTimer("client.selectSession", { sid: sessionId.slice(-8) });
    setActiveSessionId(sessionId);
    onSessionChange?.(sessionId);
    setLoadingSession(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/sessions/${sessionId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const msgs = historyToUIMessages(data);
        setInitialMessages(msgs);
        timer.end({ messageCount: msgs.length });
      } else {
        setInitialMessages([]);
        timer.end({ messageCount: 0 });
      }
    } catch {
      setInitialMessages([]);
      timer.end({ error: true });
    }
    setLoadingSession(false);
    setThreadKey((k) => k + 1);
  }, [agentId, onSessionChange]);

  const newThread = useCallback(() => {
    setActiveSessionId(null);
    onSessionChange?.(null);
    setPendingMessage(null);
    setInitialMessages([]);
    setThreadKey((k) => k + 1);
  }, [onSessionChange]);

  // Sync external prop → internal state when the URL's `?session=` param
  // changes via soft Next.js navigation. See git history for the long
  // version of why this is the documented "no useEffect" exception.
  useEffect(() => {
    if (initialSessionId === activeSessionId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (initialSessionId) {
        void selectSession(initialSessionId);
      } else if (activeSessionId) {
        newThread();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, initialSessionId, newThread, selectSession]);

  async function handleFirstMessage(message: string) {
    const timer = perfTimer("client.handleFirstMessage");
    let sessionId: string | null = null;
    try {
      const res = await fetch(`/api/agents/${agentId}/sessions/create`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.sessionId) sessionId = data.sessionId;
    } catch {
      // fallback: chat API will create session server-side
    }
    timer.mark("session-created", { hasId: !!sessionId });
    setActiveSessionId(sessionId);
    onSessionChange?.(sessionId);
    setPendingMessage(message);
    setInitialMessages([]);
    setThreadKey((k) => k + 1);
    setTimeout(loadSessions, 3000);
    timer.end();
  }

  const showGreeting = !activeSessionId && !pendingMessage;

  // Hook into the panel via nuqs at the top level so we can pass an
  // opener into the agent context. The URL grammar is the source of
  // truth — `delivery:file:<path>` is a URL-only shortcut the panel
  // host resolves directly without needing a payload registry.
  const { openDelivery: openPanelDelivery } = useRightPanel();

  const agentContextValue = useMemo(
    () => ({
      agentId,
      name: agentName,
      emoji: agentEmoji,
      vertical: agentVertical,
      sessions,
      onSelectSession: selectSession,
      onOpenFile: (path: string) => {
        openPanelDelivery(`file:${path}`);
        onOpenFile?.(path);
      },
    }),
    [agentId, agentName, agentEmoji, agentVertical, sessions, selectSession, onOpenFile, openPanelDelivery],
  );

  return (
    <div className="flex h-full overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1">
        <AgentContext.Provider value={agentContextValue}>
          {showGreeting ? (
            <AgentGreeting
              agentName={agentName}
              sessions={sessions}
              onSend={handleFirstMessage}
              onSelectSession={selectSession}
              heroSlot={greetingHeroSlot}
              bottomSlot={greetingBottomSlot}
            />
          ) : loadingSession ? (
            <div className="flex h-full items-center justify-center">
              <Spinner context="loading" label="Loading conversation…" className="text-sm text-muted-foreground" />
            </div>
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

      {showArtifacts && (
        <ArtifactPanel
          agentId={agentId}
          onClose={onCloseArtifacts ?? (() => {})}
          autoPort={detectedPort}
          openFilePath={null}
        />
      )}
    </div>
  );
}

/**
 * Single chat thread powered by the AI SDK + agent-elements.
 * Remounted (via key) when switching sessions so `useChat` re-seeds.
 */
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
  const detectedPortsRef = useRef(new Set<string>());
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(
    sessionId,
  );
  const effectiveSessionId = sessionId ?? createdSessionId;
  const playMessageArrived = useSound(MESSAGE_ARRIVED);
  const lastFinishedIdRef = useRef<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/agents/${agentId}/chat`,
        body: () => ({ sessionId: effectiveSessionId }),
        fetch: async (url, init) => {
          const response = await globalThis.fetch(url, init);
          const sid = response.headers.get("x-session-id");
          if (sid && sid !== effectiveSessionId) {
            setCreatedSessionId(sid);
          }
          return response;
        },
      }),
    [agentId, effectiveSessionId],
  );

  const { messages, sendMessage, stop, status, error } = useChat({
    transport,
    messages: initialMessages.length > 0 ? initialMessages : undefined,
  });

  // Rewrite `reasoning` parts as synthetic `tool-Thinking` parts so
  // agent-elements' ThinkingTool renders them — its MessageList
  // doesn't handle bare reasoning parts.
  const renderedMessages = useMemo(
    () => transformReasoningParts(messages),
    [messages],
  );

  // Soft chime + Daytona port sniffing when an assistant message finishes.
  // We watch `status` transitioning to "ready" with the latest assistant
  // message changing — replaces the assistant-ui `onFinish` callback.
  useEffect(() => {
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastFinishedIdRef.current === last.id) return;
    lastFinishedIdRef.current = last.id;

    playMessageArrived();

    if (!onPortDetected) return;
    const text = (last.parts ?? [])
      .filter(isTextUIMessagePart)
      .map((part) => part.text)
      .join("");
    for (const match of text.matchAll(DAYTONA_URL_REGEX)) {
      const port = match[1];
      if (port && !detectedPortsRef.current.has(port)) {
        detectedPortsRef.current.add(port);
        onPortDetected(port);
      }
    }
  }, [status, messages, onPortDetected, playMessageArrived]);

  // Auto-send the pending message once on mount (greeting → first message).
  useStrictMountEffect(() => {
    if (!pendingMessage) return;
    perfLog("client.autoSend.dispatch", { messageLen: pendingMessage.length });
    void sendMessage({ text: pendingMessage });
    onMessageSent?.();
  });

  const handleSend = useCallback(
    (msg: { role: "user"; content: string }) => {
      void sendMessage({ text: msg.content });
    },
    [sendMessage],
  );

  // Build a toolCallId → messageId index so the wrapped ToolRenderer
  // can open the right-panel trace on the correct message + tool.
  // Cheap to recompute on every render — we walk parts once.
  const toolCallToMessage = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of renderedMessages) {
      for (const part of msg.parts ?? []) {
        const p = part as { type?: string; toolCallId?: string };
        if (
          typeof p.type === "string" &&
          p.type.startsWith("tool-") &&
          typeof p.toolCallId === "string"
        ) {
          m.set(p.toolCallId, msg.id);
        }
      }
    }
    return m;
  }, [renderedMessages]);

  return (
    <ChatWithRightPanel agentId={agentId} messages={renderedMessages}>
      <ToolMessageMapContext.Provider value={toolCallToMessage}>
        <div className="relative flex h-full flex-col">
          {/* Floating action: export the entire trace (text + every tool
              call's raw input/output) as markdown. Sits over the
              MessageList so it's reachable on long threads. */}
          {renderedMessages.length > 0 && (
            <div className="pointer-events-none absolute right-3 top-3 z-10">
              <ExportTraceButton
                messages={renderedMessages}
                className="pointer-events-auto"
              />
            </div>
          )}

          <AgentChatUI
            messages={renderedMessages}
            onSend={handleSend}
            status={status}
            onStop={stop}
            error={error}
            showCopyToolbar
            enableImagePreview
            emptyStatePosition="default"
            className="h-full"
            // Wrap each tool render with an expandable raw request /
            // response section so the user can audit any call's inputs
            // and outputs, not just the registry's compact summary.
            slots={{ ToolRenderer: ToolRendererDebug }}
          />
        </div>
      </ToolMessageMapContext.Provider>
    </ChatWithRightPanel>
  );
}
