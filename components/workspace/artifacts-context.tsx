"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Artifacts provider — state backing the "Artifacts" drawer.
 *
 * Artifacts are things the agent has explicitly announced via the
 * `announce_artifact` OpenCode Custom Tool (see
 * `lib/opencode-tools/tool-sources.ts`). The tool call flows through
 * the runtime event stream → AI SDK UIMessage parts → the
 * `AnnounceArtifactToolUI` render function, which pushes the
 * structured payload into this provider via `announce()`.
 *
 * Scope: one provider instance per workspace shell mount. State
 * resets on full page navigation away from the agent. Not persisted
 * to Convex — artifacts are an ephemeral "what the agent made this
 * session" signal, not durable records. Persist them later if users
 * ask for "show me yesterday's artifacts."
 *
 * Auto-open: the drawer opens automatically on the FIRST announce
 * this session, then sticks to whatever state the user chose. A ref
 * tracks "have we auto-opened yet" so subsequent announces don't
 * yank the drawer back open after the user dismisses it.
 */

export type Artifact = {
  /**
   * Stable dedup key. Derived from the tool call (preferred) or a
   * content fingerprint (fallback). Repeated announces with the
   * same id update the existing entry in place rather than
   * appending a duplicate.
   */
  id: string;
  kind: "webapp" | "page" | "file" | "report";
  title: string;
  port?: number;
  path?: string;
  description?: string;
  /** Wall-clock ms when this announce landed. */
  announcedAt: number;
};

type ArtifactsContextValue = {
  artifacts: readonly Artifact[];
  announce: (input: Omit<Artifact, "announcedAt">) => void;
  clear: () => void;
  /** Currently-selected artifact for the drawer's viewer pane. */
  selectedId: string | null;
  select: (id: string | null) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const ArtifactsContext = createContext<ArtifactsContextValue>({
  artifacts: [],
  announce: () => {},
  clear: () => {},
  selectedId: null,
  select: () => {},
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function ArtifactsProvider({ children }: { children: React.ReactNode }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hasAutoOpenedRef = useRef(false);

  const announce = useCallback(
    (input: Omit<Artifact, "announcedAt">) => {
      setArtifacts((prev) => {
        const idx = prev.findIndex((a) => a.id === input.id);
        if (idx >= 0) {
          const existing = prev[idx];
          // Content-level dedup: if every user-visible field matches
          // the existing entry, return `prev` so React bails on the
          // re-render. Critical — announce() can fire multiple times
          // per tool call as args stream in, and a fresh timestamp
          // on every call would cause an infinite render loop.
          if (
            existing.kind === input.kind &&
            existing.title === input.title &&
            existing.port === input.port &&
            existing.path === input.path &&
            existing.description === input.description
          ) {
            return prev;
          }
          const next = [...prev];
          // Preserve the original `announcedAt` so the sort order
          // doesn't jump around when late args arrive.
          next[idx] = { ...input, announcedAt: existing.announcedAt };
          return next;
        }
        return [...prev, { ...input, announcedAt: Date.now() }];
      });
      setSelectedId((prev) => prev ?? input.id);
      setIsOpen((current) => {
        if (hasAutoOpenedRef.current) return current;
        hasAutoOpenedRef.current = true;
        return true;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setArtifacts([]);
    setSelectedId(null);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const select = useCallback(
    (id: string | null) => setSelectedId(id),
    [],
  );

  const value = useMemo<ArtifactsContextValue>(
    () => ({
      artifacts,
      announce,
      clear,
      selectedId,
      select,
      isOpen,
      open,
      close,
      toggle,
    }),
    [artifacts, announce, clear, selectedId, select, isOpen, open, close, toggle],
  );

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}

export function useArtifacts() {
  return useContext(ArtifactsContext);
}
