"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { AgentAvatar, type AvatarTheme } from "@/components/agent-avatar";
import { ArrowUp, ChatCircle } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/unicode-spinner";

const DEFAULT_SUGGESTIONS = [
  "Help me build something",
  "Research a topic",
  "Write some code",
  "Create a website",
];

type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  isAutomation?: boolean;
};

export function AgentGreeting({
  agentName,
  agentTheme,
  suggestions = DEFAULT_SUGGESTIONS,
  sessions = [],
  onSend,
  onSelectSession,
  heroSlot,
  bottomSlot,
}: {
  agentName: string;
  agentTheme?: AvatarTheme;
  suggestions?: string[];
  sessions?: SessionItem[];
  onSend: (message: string) => void;
  onSelectSession?: (sessionId: string) => void;
  /**
   * Optional custom hero content. Replaces the default
   * "Let's get started / How can I help?" block when provided.
   * Used by the agent home page to show the dynamic status headline.
   */
  heroSlot?: ReactNode;
  /**
   * Optional custom content shown below the composer + suggestions.
   * Used by the agent home page to show the activity feed.
   * When provided, the default "Recent sessions" grid is hidden.
   */
  bottomSlot?: ReactNode;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  function handleSubmit() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSuggestion(text: string) {
    if (sending) return;
    setSending(true);
    onSend(text);
  }

  const hasSessions = sessions.length > 0;

  return (
    <div className={`relative flex h-full flex-col items-center gap-6 overflow-y-auto px-4 ${hasSessions ? "pt-[15vh]" : "justify-center"}`}>
      {/* Dot grid background */}
      <div className="dot-grid" />

      {/* Avatar */}
      <div
        className="greeting-enter relative"
        style={{ animationDelay: "0ms" }}
      >
        <AgentAvatar name={agentName} size="lg" theme={agentTheme} />
      </div>

      {/* Hero text — custom slot or default */}
      <div
        className="greeting-enter relative text-center"
        style={{ animationDelay: "80ms" }}
      >
        {heroSlot ?? (
          <>
            <h1 className="font-serif text-[28px] font-normal leading-tight tracking-tight text-foreground">
              Let&apos;s get started
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              How can I help?
            </p>
          </>
        )}
      </div>

      {/* Composer */}
      <div
        className="greeting-enter relative w-full max-w-[540px]"
        style={{ animationDelay: "160ms" }}
      >
        <div className="flex w-full items-center gap-2 rounded-[20px] border border-border/60 bg-background p-3 shadow-[0_0_0_0.7px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.03),0_2px_2px_rgba(0,0,0,0.02),0_1px_5px_rgba(0,0,0,0.05)] transition-shadow duration-200 focus-within:shadow-[0_0_0_0.7px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),0_2px_4px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_0.7px_rgba(255,255,255,0.06),0_1px_1px_rgba(0,0,0,0.2),0_2px_2px_rgba(0,0,0,0.15),0_1px_5px_rgba(0,0,0,0.25)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            disabled={sending}
            rows={1}
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            autoFocus
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || sending}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-30"
          >
            {sending ? (
              <Spinner context="button" />
            ) : (
              <ArrowUp className="size-4" />
            )}
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
            disabled={sending}
            className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>

      {/* Bottom slot — custom content (e.g. activity feed) overrides
          the default Recent sessions grid */}
      {bottomSlot ? (
        <div
          className="greeting-enter relative mt-4 w-full max-w-[540px] pb-8"
          style={{ animationDelay: "320ms" }}
        >
          {bottomSlot}
        </div>
      ) : (
        hasSessions && (
          <div
            className="greeting-enter relative mt-4 w-full max-w-[540px] pb-8"
            style={{ animationDelay: "320ms" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <ChatCircle className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Recent sessions
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {sessions.slice(0, 4).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectSession?.(session.id)}
                  disabled={sending}
                  className="flex flex-col gap-1 rounded-xl border border-border bg-background p-3.5 text-left transition-colors hover:bg-accent/50 disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-[13px] font-medium text-foreground">
                    {session.title}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {session.isAutomation && (
                      <span className="rounded-full bg-accent px-1.5 py-px text-[9px] font-medium text-accent-foreground">
                        Auto
                      </span>
                    )}
                    {session.updatedAt && (
                      <span className="text-[11px] text-muted-foreground">
                        {session.updatedAt}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
