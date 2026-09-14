"use client";

import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";

const defaultUser = {
  id: "",
  name: "",
  email: "",
  plan: "Pro",
  credits: { used: 0, total: 5000 },
  avatar: null as string | null,
  nickname: "",
  company: "",
  industry: "",
  background: "",
  customInstructions: "",
  timezone: "",
  soundEnabled: false,
};

/**
 * Current user profile, credits, and personalization from Convex.
 */
export function useUser() {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (user === undefined) {
    return { data: defaultUser, isLoading: true, error: null };
  }

  if (user === null) {
    return { data: defaultUser, isLoading: false, error: null };
  }

  return {
    data: {
      id: user.id as string,
      name: user.name,
      email: user.email,
      plan: user.plan,
      credits: user.credits,
      avatar: user.image,
      nickname: user.nickname,
      company: user.company,
      industry: user.industry,
      background: user.background,
      customInstructions: user.customInstructions,
      timezone: user.timezone,
      soundEnabled: user.soundEnabled,
    },
    isLoading: false,
    error: null,
  };
}
