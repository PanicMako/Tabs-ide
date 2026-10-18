/** Labels describe evidence, never replace the server's approval checks. */
export function reviewPresentation(entry: {
  status: string;
  digest: string;
  scan_result: unknown;
}) {
  const scan =
    entry.scan_result && typeof entry.scan_result === "object"
      ? (entry.scan_result as { passed?: unknown; digest?: unknown; issues?: unknown })
      : undefined;
  const bound =
    scan?.digest === entry.digest &&
    typeof scan?.passed === "boolean" &&
    Array.isArray(scan.issues);
  const blocked =
    bound &&
    (scan.issues as unknown[]).some(
      (issue) =>
        issue && typeof issue === "object" && "severity" in issue && issue.severity === "blocking",
    );
  if (entry.status === "approved")
    return {
      label: "Approved",
      tone: "approved",
      guidance: "Review complete. Signed publication is a separate step.",
    };
  if (entry.status === "queued")
    return {
      label: "Waiting for scan",
      tone: "waiting",
      guidance: "The scanner will pick this up. Check back before making a decision.",
    };
  if (entry.status === "scanning")
    return {
      label: "Scanning",
      tone: "waiting",
      guidance: "Package checks are running. A decision becomes available when they finish.",
    };
  if (entry.status !== "review")
    return {
      label: "Check status",
      tone: "waiting",
      guidance: "Refresh the queue to confirm this package’s current state.",
    };
  if (!bound)
    return {
      label: "Evidence incomplete",
      tone: "attention",
      guidance: "A complete scan for this exact package is needed before approval.",
    };
  if (!scan.passed || blocked)
    return {
      label: "Needs attention",
      tone: "attention",
      guidance: "The scan has blocking findings. Inspect them before deciding what to do.",
    };
  return {
    label: "Ready for review",
    tone: "ready",
    guidance: (scan.issues as unknown[]).length
      ? "Scan complete, with findings to inspect. Review the evidence below."
      : "Scan complete, with no findings. Inspect the package before recording your decision.",
  };
}
