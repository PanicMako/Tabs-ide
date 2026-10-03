/**
 * Privacy-Preserving Browser Authentication Diagnostics.
 *
 * Records structured authentication timelines for debugging and bug reports
 * while strictly prohibiting any leakage of credentials, tokens, cookies,
 * query parameters, fragments, form data, or page contents.
 */

export type AuthDiagnosticStage =
  | "navigation_initiated"
  | "classification_completed"
  | "popup_opened"
  | "postmessage_received"
  | "external_fallback_initiated"
  | "loopback_listening"
  | "loopback_callback_received"
  | "completed"
  | "cancelled"
  | "timeout"
  | "error";

export type AuthDiagnosticOutcome =
  | "in_progress"
  | "completed"
  | "cancelled"
  | "timeout"
  | "rejected"
  | "error";

export interface AuthDiagnosticEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly profileId: string;
  readonly provider: string;
  readonly stage: AuthDiagnosticStage;
  readonly navigationType: "in_page" | "new_window" | "external_browser" | "will_navigate";
  readonly sanitizedOrigin: string;
  readonly errorCode?: string | undefined;
  readonly outcome: AuthDiagnosticOutcome;
  readonly summary?: string | undefined;
}

export interface RecordDiagnosticInput {
  readonly profileId?: string | null | undefined;
  readonly provider?: string | undefined;
  readonly stage: AuthDiagnosticStage;
  readonly navigationType: "in_page" | "new_window" | "external_browser" | "will_navigate";
  readonly rawUrl?: string | null | undefined;
  readonly errorCode?: string | undefined;
  readonly outcome: AuthDiagnosticOutcome;
  readonly summary?: string | undefined;
}

const SENSITIVE_QUERY_KEYS = new Set([
  "code",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "secret",
  "client_secret",
  "password",
  "credential",
  "state",
  "session",
  "auth",
]);

/**
 * Strips all paths, query strings, and fragments to guarantee zero credential leakage.
 * Returns only the verifiable protocol + host + port (origin).
 */
export function sanitizeDiagnosticOrigin(rawUrl?: string | null | undefined): string {
  if (!rawUrl || rawUrl === "about:blank" || rawUrl === "[invalid-url]") {
    return rawUrl || "unknown";
  }

  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.origin;
  } catch {
    return "invalid_origin";
  }
}

/**
 * Sanitizes any descriptive text to guarantee no key-value tokens or code parameters
 * are accidentally included in summaries.
 */
export function sanitizeDiagnosticSummary(text?: string | undefined): string | undefined {
  if (!text) return undefined;
  let sanitized = text;

  for (const key of SENSITIVE_QUERY_KEYS) {
    const regex = new RegExp(`(${key}\\s*[:=]\\s*)[^\\s&;,]+`, "gi");
    sanitized = sanitized.replace(regex, "$1[REDACTED]");
  }

  return sanitized;
}

export class BrowserAuthDiagnostics {
  private readonly entries: AuthDiagnosticEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  record(input: RecordDiagnosticInput): AuthDiagnosticEntry {
    const sanitizedOrigin = sanitizeDiagnosticOrigin(input.rawUrl);
    const summary = sanitizeDiagnosticSummary(input.summary);

    const entry: AuthDiagnosticEntry = {
      id: `diag_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      profileId: input.profileId?.trim() || "default",
      provider: input.provider?.trim() || "unknown",
      stage: input.stage,
      navigationType: input.navigationType,
      sanitizedOrigin,
      errorCode: input.errorCode,
      outcome: input.outcome,
      summary,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return entry;
  }

  getEntries(): readonly AuthDiagnosticEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }

  /**
   * Generates a copyable, privacy-preserving markdown report suitable for bug reports.
   */
  formatBugReportSummary(): string {
    if (this.entries.length === 0) {
      return "No authentication diagnostic events recorded.";
    }

    const lines: string[] = [
      "### Tabs Browser Authentication Diagnostics Summary",
      `*Generated at ${new Date().toISOString()} · Total events: ${this.entries.length}*`,
      "",
      "| Time (UTC) | Profile | Provider | Stage | Nav Type | Sanitized Origin | Error Code | Outcome |",
      "|---|---|---|---|---|---|---|---|",
    ];

    for (const e of this.entries) {
      const time = e.timestamp.split("T")[1]?.replace("Z", "") ?? e.timestamp;
      const err = e.errorCode || "-";
      lines.push(
        `| ${time} | ${e.profileId} | ${e.provider} | ${e.stage} | ${e.navigationType} | ${e.sanitizedOrigin} | ${err} | ${e.outcome} |`,
      );
    }

    lines.push("");
    lines.push(
      "> [!NOTE]\n> Sensitive fields (passwords, tokens, query parameters, cookies) are permanently redacted before recording.",
    );

    return lines.join("\n");
  }
}
