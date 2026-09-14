"use client";

import { createContext, useContext } from "react";

type AgentInfo = {
  agentId: string;
  name: string;
  emoji?: string;
  vertical: string;
  sessions: Array<{ id: string; title: string; updatedAt: string }>;
  onSelectSession: (id: string) => void;
  onOpenFile?: (path: string) => void;
};

export const AgentContext = createContext<AgentInfo>({
  agentId: "",
  name: "",
  vertical: "",
  sessions: [],
  onSelectSession: () => {},
});

export function useAgentContext() {
  return useContext(AgentContext);
}
