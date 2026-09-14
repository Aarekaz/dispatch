function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;

  if (!value) {
    return "";
  }

  return value;
}

export const env = {
  runtimeKind: required("DISPATCH_RUNTIME_KIND", "opencode"),
  convexUrl: required("NEXT_PUBLIC_CONVEX_URL"),
  daytonaApiUrl: required("DAYTONA_API_URL"),
  opencodeBaseUrl: required("OPENCODE_BASE_URL")
};
