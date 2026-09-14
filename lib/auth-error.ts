type AuthErrorCtx = {
  error?: {
    code?: unknown;
    message?: unknown;
    statusText?: unknown;
    status?: unknown;
  };
};

const HUMAN_BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Invalid email or password.",
  USER_ALREADY_EXISTS: "An account with this email already exists.",
  USER_NOT_FOUND: "No account found for this email.",
  EMAIL_NOT_VERIFIED: "Please verify your email before signing in.",
  PASSWORD_TOO_SHORT: "Password is too short.",
  PASSWORD_TOO_LONG: "Password is too long.",
  CREDENTIAL_ACCOUNT_NOT_FOUND:
    "This account was created with a different sign-in method.",
  FAILED_TO_CREATE_USER: "We couldn't create your account. Please try again.",
  FAILED_TO_CREATE_SESSION:
    "Signed up, but couldn't start a session. Try signing in.",
  RATE_LIMIT_EXCEEDED: "Too many attempts. Try again in a moment.",
};

export function authErrorMessage(ctx: AuthErrorCtx, fallback: string): string {
  const err = ctx.error ?? {};
  const code = typeof err.code === "string" ? err.code : "";
  const message = typeof err.message === "string" ? err.message.trim() : "";
  const statusText =
    typeof err.statusText === "string" ? err.statusText.trim() : "";
  const status = typeof err.status === "number" ? err.status : 0;

  if (code && HUMAN_BY_CODE[code]) return HUMAN_BY_CODE[code];
  if (message) return message;

  if (status === 404 || statusText === "Not Found") {
    return "Auth service unreachable. The Better Auth routes are not mounted on the current Convex deployment.";
  }
  if (statusText) return statusText;
  return fallback;
}
