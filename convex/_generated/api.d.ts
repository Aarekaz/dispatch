/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentAutomationRuns from "../agentAutomationRuns.js";
import type * as agentAutomations from "../agentAutomations.js";
import type * as agentDefinition from "../agentDefinition.js";
import type * as agentMemoryFiles from "../agentMemoryFiles.js";
import type * as agentWorkspaceFiles from "../agentWorkspaceFiles.js";
import type * as agents from "../agents.js";
import type * as authHelpers from "../authHelpers.js";
import type * as chat from "../chat.js";
import type * as chatState from "../chatState.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as runs from "../runs.js";
import type * as runtime_adapter from "../runtime/adapter.js";
import type * as runtime_opencode_adapter from "../runtime/opencode_adapter.js";
import type * as sessions from "../sessions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentAutomationRuns: typeof agentAutomationRuns;
  agentAutomations: typeof agentAutomations;
  agentDefinition: typeof agentDefinition;
  agentMemoryFiles: typeof agentMemoryFiles;
  agentWorkspaceFiles: typeof agentWorkspaceFiles;
  agents: typeof agents;
  authHelpers: typeof authHelpers;
  chat: typeof chat;
  chatState: typeof chatState;
  credits: typeof credits;
  crons: typeof crons;
  http: typeof http;
  integrations: typeof integrations;
  runs: typeof runs;
  "runtime/adapter": typeof runtime_adapter;
  "runtime/opencode_adapter": typeof runtime_opencode_adapter;
  sessions: typeof sessions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
