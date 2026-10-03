import * as OS from "node:os";

import type { ServerSupportBundleResult, ServerTraceDiagnosticsResult } from "@tabs/contracts";

import { readProcessDiagnostics, readProcessResourceHistory } from "./ProcessDiagnostics.ts";

export function redactSupportBundleText(text: string): string {
  const home = OS.homedir();
  return text
    .replaceAll(home, "<home>")
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/giu,
      "<redacted-header>",
    )
    .replace(
      /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[=:]\s*)[^\s,;]+/giu,
      "$1<redacted>",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/giu, "$1<redacted>@")
    .replace(
      /\b(?:Bearer\s+)?(?:gh[opsu]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{32,})\b/giu,
      "<redacted-token>",
    )
    .replace(/([?&](?:token|key|secret|code|credential)=)[^&\s"]+/giu, "$1<redacted>");
}

/** Redact by field meaning before serialization, including short secrets regex cannot recognize. */
export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(?:api.?key|token|secret|password|credential|authorization|cookie|prompt|source|content|input|command|argv|cwd|path|repository|remote|account.?id|user.?id|environment.?id)/i.test(
          key,
        )
          ? "<redacted>"
          : redactDiagnosticValue(item),
      ]),
    );
  }
  return typeof value === "string" ? redactSupportBundleText(value) : value;
}

export async function createSupportBundle(input: {
  readonly environmentId: string;
  readonly appVersion: string;
  readonly traces: ServerTraceDiagnosticsResult;
}): Promise<ServerSupportBundleResult> {
  const [processes, history] = await Promise.all([
    readProcessDiagnostics(),
    readProcessResourceHistory({ windowMs: 60 * 60_000, bucketMs: 30_000 }),
  ]);
  const generatedAt = new Date().toISOString();
  const content = redactSupportBundleText(
    JSON.stringify(
      redactDiagnosticValue({
        schemaVersion: 1,
        generatedAt,
        environmentId: input.environmentId,
        appVersion: input.appVersion,
        platform: { platform: process.platform, arch: process.arch, node: process.version },
        processes,
        processHistory: history,
        traces: input.traces,
      }),
      null,
      2,
    ),
  );
  const day = generatedAt.slice(0, 10);
  return {
    filename: `tabs-support-${day}.json`,
    mediaType: "application/json",
    byteLength: new TextEncoder().encode(content).byteLength,
    content,
  };
}
