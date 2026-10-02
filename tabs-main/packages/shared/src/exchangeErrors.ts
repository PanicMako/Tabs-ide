const recovery: Record<string, string> = {
  TERMS_ACCEPTANCE_REQUIRED:
    "Accept the current publisher terms on this registry's Account page (/account) before uploading.",
  VERSION_ALREADY_SUBMITTED:
    "This version already exists. Check submission status; corrected content requires you to increment the manifest version and rebuild.",
  PUBLISHING_DISABLED:
    "This registry is not accepting submissions. Contact its operator; do not retry automatically.",
  AUTHENTICATION_REQUIRED:
    "Sign in again or reconnect your registry token to continue. Authentication expiry is not package revocation.",
  ACCESS_DENIED:
    "Sign in again, or check your namespace membership and reviewer access, to continue.",
  INVALID_REQUEST:
    "Check the submitted fields or package with the current documentation and validator before retrying.",
  NOT_FOUND:
    "Check the requested identity and your current access. The resource may be unavailable or not published.",
  STATE_CONFLICT:
    "Refresh status and inspect the recorded result before retrying. No automatic retry was made.",
  PACKAGE_TOO_LARGE:
    "Use a non-empty .tabsext package no larger than 25 MiB and exclude source tooling and dependencies.",
  UNSUPPORTED_MEDIA: "Upload the raw .tabsext archive using the documented publishing flow.",
  RATE_LIMITED:
    "Wait before retrying. Check whether an earlier submission was accepted; do not retry automatically.",
  SERVICE_UNAVAILABLE:
    "The registry is unavailable. Check status or contact its operator. No automatic retry was made.",
  INTERNAL_ERROR:
    "The registry could not complete the request. Check status before retrying or contact its operator. No automatic retry was made.",
};

export function exchangeErrorCode(status: number): string {
  return (
    (
      {
        400: "INVALID_REQUEST",
        401: "AUTHENTICATION_REQUIRED",
        403: "ACCESS_DENIED",
        404: "NOT_FOUND",
        409: "STATE_CONFLICT",
        413: "PACKAGE_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA",
        429: "RATE_LIMITED",
        503: "SERVICE_UNAVAILABLE",
      } as Record<number, string>
    )[status] ?? "INTERNAL_ERROR"
  );
}

export function exchangeErrorGuidance(
  status: number,
  body: unknown,
): { code: string; message: string } {
  const offered = body && typeof body === "object" && "code" in body ? body.code : undefined;
  const code =
    typeof offered === "string" && Object.hasOwn(recovery, offered)
      ? offered
      : exchangeErrorCode(status);
  return { code, message: recovery[code]! };
}
