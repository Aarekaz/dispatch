"use client";

import { useState, useRef } from "react";
import { PaperPlaneTilt as Send } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useModels } from "@/hooks/use-agent-config";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AgentComposer({
  agentName,
  onSend,
}: {
  agentName: string;
  onSend?: (message: string) => void;
  skills?: unknown[];
}) {
  const { data: availableModels } = useModels();
  const [value, setValue] = useState("");
  const [selectedModel, setSelectedModel] = useState(availableModels[0]?.id ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-shadow focus-within:shadow-card-hover">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={`Chat with ${agentName}`}
          rows={1}
          className="block w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />

        <div className="flex items-center justify-end px-3 pb-3">
          <div className="flex items-center gap-2">
            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? "")}>
              <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 font-mono text-[12px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {availableModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <span>{model.label}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {model.provider}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="icon-xs"
              onClick={handleSubmit}
              disabled={!value.trim()}
              className={cn(
                "size-8 rounded-full",
                !value.trim() && "bg-muted text-muted-foreground",
              )}
            >
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
