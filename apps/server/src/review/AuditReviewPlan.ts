import type { AuditReviewOptions } from "@tabs/contracts";

/** Execution choices shared by every audit request, independent of UI labels. */
export function auditReviewPlan(options: AuditReviewOptions) {
  const targetPaths = (options.targetPaths ?? []).map((path) => {
    const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split("/").some((part) => part === ".." || part === "")
    ) {
      throw new Error("Audit paths must stay inside the repository.");
    }
    return normalized;
  });
  const focus =
    options.mode === "security"
      ? "security"
      : options.mode === "architecture"
        ? "architecture"
        : options.mode === "refactoring"
          ? "refactoring"
          : "correctness";
  const passes =
    options.depth === "quick"
      ? [focus]
      : options.mode === "full_audit"
        ? ["correctness", "security", "performance", "architecture"]
        : [...new Set([focus, "security"])];
  if (options.depth === "deep")
    passes.push(...["api_compatibility", "test_gap"].filter((pass) => !passes.includes(pass)));
  return {
    targetPaths,
    passes,
    maxFileLines: options.depth === "quick" ? 75 : options.depth === "deep" ? 400 : 150,
    maxPatchChars:
      options.depth === "quick" ? 75_000 : options.depth === "deep" ? 600_000 : 300_000,
  };
}
