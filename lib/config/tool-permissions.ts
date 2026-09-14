export type ToolPreset = "conservative" | "balanced" | "permissive";

export type ToolPermission = "allow" | "deny";

export type ToolPermissionMap = Record<string, ToolPermission>;

export const TOOL_PRESETS: Record<
  ToolPreset,
  {
    label: string;
    description: string;
    permissions: ToolPermissionMap;
  }
> = {
  conservative: {
    label: "Conservative",
    description:
      "Read-only workspace access, no terminal or external actions. Best for agents handling sensitive data.",
    permissions: {
      bash: "deny",
      read: "allow",
      write: "deny",
      edit: "deny",
      browser: "deny",
      email: "deny",
      memory: "allow",
      web_fetch: "allow",
      web_search: "allow",
    },
  },
  balanced: {
    label: "Balanced",
    description:
      "Full workspace access, no email or browser. Recommended for most agents.",
    permissions: {
      bash: "allow",
      read: "allow",
      write: "allow",
      edit: "allow",
      browser: "deny",
      email: "deny",
      memory: "allow",
      web_fetch: "allow",
      web_search: "allow",
    },
  },
  permissive: {
    label: "Permissive",
    description:
      "Full autonomy — terminal, files, browser, and email. Best for trusted dev agents.",
    permissions: {
      bash: "allow",
      read: "allow",
      write: "allow",
      edit: "allow",
      browser: "allow",
      email: "allow",
      memory: "allow",
      web_fetch: "allow",
      web_search: "allow",
    },
  },
};

export const DEFAULT_PRESET: ToolPreset = "balanced";

export function getPresetPermissions(
  preset: string | undefined,
): ToolPermissionMap {
  return (
    TOOL_PRESETS[(preset as ToolPreset) ?? DEFAULT_PRESET]?.permissions ??
    TOOL_PRESETS[DEFAULT_PRESET].permissions
  );
}
