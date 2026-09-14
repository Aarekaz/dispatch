import type { AgentType, OnboardingStep } from "@/lib/types";

/* ── Agent types for deploy selector ──────── */

export const agentTypes: AgentType[] = [
  { id: "executive-assistant", label: "Executive assistance", icon: "user" },
  { id: "customer-support", label: "Customer support", icon: "headset" },
  { id: "social-media", label: "Social media manager", icon: "users" },
  { id: "dispatch-atlas", label: "Dispatch Atlas", icon: "sparkle" },
  { id: "custom-agent", label: "Custom agent", icon: "settings" },
  { id: "marketplace", label: "Agent marketplace", icon: "store" },
];

/* ── Agent packs ──────────────────────────── */

export { agentPacks } from "@/lib/templates";

/* ── Onboarding steps ─────────────────────── */

export const onboardingSteps: OnboardingStep[] = [
  { id: "deploy", label: "Deploy agent", completed: false },
  { id: "connect", label: "Connect a channel", completed: false },
  { id: "task", label: "Run first task", completed: false },
  { id: "invite", label: "Invite a teammate", completed: false },
];

/* ── Available models ─────────────────────── */

export { MODELS as availableModels } from "./models";
