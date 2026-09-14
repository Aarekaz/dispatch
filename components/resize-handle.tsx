"use client";

import { useCallback, useRef, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

const STORAGE_KEY = "dispatch:workspace-width";
const MIN_CHAT_WIDTH = 300;
const MIN_WORKSPACE_WIDTH = 280;

export function useResizablePanel(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(null);

  // Read saved width from localStorage once on mount
  useMountEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_WORKSPACE_WIDTH) {
          setWorkspaceWidth(parsed);
        }
      }
    } catch {
      // localStorage unavailable
    }
  });

  const dragWidthRef = useRef<number | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (moveEvent: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const newWorkspaceWidth = containerRect.right - moveEvent.clientX;
        const availableWidth = containerRect.width;

        // Collapse workspace if dragged below minimum
        if (newWorkspaceWidth < MIN_WORKSPACE_WIDTH) {
          dragWidthRef.current = 0;
          const panel = container.querySelector("[data-workspace-panel]") as HTMLElement | null;
          if (panel) panel.style.width = "0px";
          return;
        }

        // Enforce minimum chat width
        const chatWidth = availableWidth - newWorkspaceWidth;
        if (chatWidth < MIN_CHAT_WIDTH) return;

        // Update DOM directly — no setState during drag
        dragWidthRef.current = newWorkspaceWidth;
        const panel = container.querySelector("[data-workspace-panel]") as HTMLElement | null;
        if (panel) panel.style.width = `${newWorkspaceWidth}px`;
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);

        // Commit final width to state (one re-render on release)
        const container = containerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const finalWidth = containerRect.right - upEvent.clientX;
        const widthToSave = finalWidth >= MIN_WORKSPACE_WIDTH ? finalWidth : 0;
        setWorkspaceWidth(widthToSave);
        dragWidthRef.current = null;

        try {
          localStorage.setItem(STORAGE_KEY, String(Math.round(widthToSave)));
        } catch {
          // localStorage unavailable
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [containerRef],
  );

  // Returns a sensible default when no saved width exists
  const getInitialWidth = useCallback((containerWidth: number) => {
    const available = containerWidth - MIN_CHAT_WIDTH;
    if (available < MIN_WORKSPACE_WIDTH) return available;
    return Math.min(440, available);
  }, []);

  return { workspaceWidth, onMouseDown, getInitialWidth };
}

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors duration-150 hover:bg-accent"
    >
      {/* Pill indicator */}
      <div className="h-8 w-0.5 rounded-full bg-border transition-colors duration-150 group-hover:bg-muted-foreground/50" />
    </div>
  );
}
