import type {
  DeviceComparisonInput,
  DeviceComparisonReport,
  DeviceComparisonTarget,
} from "@tabs/contracts";

export type Request = DeviceComparisonInput extends infer Input
  ? Input extends DeviceComparisonInput
    ? Omit<Input, "threadId">
    : never
  : never;

export const deviceKey = (device: DeviceComparisonTarget) =>
  JSON.stringify([device.hostId, device.deviceId]);
export const appIdValid = (value: string) =>
  /^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+$/.test(value.trim());
export const reason = (error: unknown) =>
  typeof error === "object" && error && "reason" in error && typeof error.reason === "string"
    ? error.reason
    : error instanceof Error
      ? error.message
      : "Device comparison request failed.";

export type ApprovalRequest = Extract<Request, { action: "approveAgentRecording" }>;

export function confirmsApproval(
  run: DeviceComparisonReport | undefined,
  request: ApprovalRequest,
) {
  return (
    run?.runId === request.runId &&
    run.savedAt === undefined &&
    run.approvalId === request.approvalRequestId &&
    run.phase !== "stopped"
  );
}

export const AGENT_APPROVAL_LABEL = "Approve";

export const TOTAL_CHECK_NONE_TEXT = "No total check — totals won't be compared.";

/**
 * Whether the comparison compares totals. Prefers the contract's `totalCheck`
 * field and falls back to whether a total was configured.
 */
export function totalCheckOf(run: DeviceComparisonReport): "configured" | "none" {
  const field = run.agentRecording?.totalCheck ?? run.totalCheck;
  if (field === "configured" || field === "none") return field;
  return run.agentRecording?.total !== undefined || run.totalVerification !== undefined
    ? "configured"
    : "none";
}

/** One sentence naming exactly what a single "Approve" grants. */
export function approvalSummary(input: {
  source: DeviceComparisonTarget & { name: string; appId: string };
  target: DeviceComparisonTarget & { name: string; appId: string };
  total: boolean;
  draft?: string;
  profile?: string | undefined;
}) {
  const { source, target } = input;
  const parts = [`Use ${source.appId} on ${source.name} and ${target.appId} on ${target.name}`];
  if (input.total) parts.push("pause if totals differ");
  if (input.draft !== undefined)
    parts.push(
      `attach both screenshots to “${input.draft}”${input.profile ? ` in ${input.profile}` : ""}`,
    );
  const last = parts.pop() as string;
  return `${parts.length > 0 ? `${parts.join(", ")}, and ` : ""}${last}.`;
}

/** Draft receipts: only an image receipt proves the screenshots are on the page. */
export function draftReceiptKind(result: unknown): "image" | "pageText" | undefined {
  const kind =
    typeof result === "object" && result !== null && "receiptKind" in result
      ? result.receiptKind
      : undefined;
  return kind === "image" || kind === "pageText" ? kind : undefined;
}
