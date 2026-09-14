"use client";

import { useState } from "react";
import { Pencil } from "@phosphor-icons/react";

import { AgentAvatar } from "@/components/agent-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Editable identity hero — controlled component used by the agent
 * settings page. Name and vertical are click-to-edit; the rest of
 * the hero (avatar, reachability sentence, channel summary) is owned
 * by the parent page so we can present a single coherent form.
 *
 * Click the name or vertical text → swaps to an inline Input. Blur
 * (or Enter) commits to the parent draft via `onChange`. Escape
 * cancels and reverts to the original value.
 *
 * The avatar is intentionally NOT yet editable here — when we add
 * avatar customization (emoji picker / image upload), it goes here.
 */
export function AgentManagementIdentity({
  name,
  vertical,
  reachabilitySentence,
  onChangeName,
  onChangeVertical,
}: {
  name: string;
  vertical: string;
  reachabilitySentence: React.ReactNode;
  onChangeName: (value: string) => void;
  onChangeVertical: (value: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-4">
        <AgentAvatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <EditableLine
            value={name}
            onCommit={onChangeName}
            placeholder="Agent name"
            className="text-xl font-semibold tracking-tight text-foreground"
            ariaLabel="Edit agent name"
          />
          <EditableLine
            value={vertical}
            onCommit={onChangeVertical}
            placeholder="Role / vertical"
            className="mt-0.5 text-sm text-muted-foreground"
            ariaLabel="Edit agent role"
          />
        </div>
      </div>

      <p className="mt-6 max-w-2xl font-serif text-2xl font-normal leading-snug tracking-tight text-muted-foreground md:text-3xl">
        {reachabilitySentence}
      </p>
    </section>
  );
}

/**
 * Click-to-edit single-line text. Renders as text by default; on
 * click swaps to an Input pre-filled with the current value. Blur
 * or Enter commits, Escape cancels. Hover reveals a subtle pencil
 * affordance so users know the field is editable.
 */
function EditableLine({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEdit() {
    setDraft(value);
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  }
  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        autoFocus
        placeholder={placeholder}
        className={cn(
          "h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0",
          className,
        )}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        "group inline-flex items-baseline gap-1.5 rounded text-left outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      aria-label={ariaLabel}
    >
      <span className={value ? "" : "text-muted-foreground"}>
        {value || placeholder}
      </span>
      <Pencil
        className="size-3 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}
