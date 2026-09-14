"use client";

import { useQuery } from "convex/react";
import type { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";

/**
 * Wraps Convex useQuery to return { data, isLoading, error } shape.
 *
 * Convex useQuery returns T | undefined (undefined = loading).
 * Our hooks use { data: T | null, isLoading: boolean, error: string | null }.
 */
export function useConvexQuery<
  F extends FunctionReference<"query">,
>(
  query: F,
  args: FunctionArgs<F> | "skip",
): {
  data: FunctionReturnType<F> | null;
  isLoading: boolean;
  error: string | null;
} {
  const result = useQuery(query, args);

  if (result === undefined) {
    return { data: null, isLoading: true, error: null };
  }

  return { data: result, isLoading: false, error: null };
}
