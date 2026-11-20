export type OtlpSignal = "traces" | "metrics" | "logs";

export const OTLP_SIGNALS: ReadonlyArray<{
  readonly signal: OtlpSignal;
  readonly key: "otlpTracesUrl" | "otlpMetricsUrl" | "otlpLogsUrl";
  readonly title: string;
  readonly placeholder: string;
}> = [
  {
    signal: "traces",
    key: "otlpTracesUrl",
    title: "Traces",
    placeholder: "http://localhost:4318/v1/traces",
  },
  {
    signal: "metrics",
    key: "otlpMetricsUrl",
    title: "Metrics",
    placeholder: "http://localhost:4318/v1/metrics",
  },
  {
    signal: "logs",
    key: "otlpLogsUrl",
    title: "Logs",
    placeholder: "http://localhost:4318/v1/logs",
  },
];

/** An endpoint is empty (off) or an http(s) URL. Returns what to tell the person, or null when fine. */
export function otlpUrlProblem(value: string): string | null {
  const text = value.trim();
  if (text.length === 0) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? null
      : "Use an http:// or https:// address.";
  } catch {
    return "That does not look like a web address. Try http://localhost:4318/v1/traces.";
  }
}
