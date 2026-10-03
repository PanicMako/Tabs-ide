import type { TestingFailureClassification } from "@tabs/contracts";

export interface ClassifiedFailure {
  readonly classification: TestingFailureClassification;
  readonly isRepairable: boolean;
  readonly reason: string;
}

export function classifyExecutionFailure(
  errorMessage: string | null | undefined,
): ClassifiedFailure {
  if (!errorMessage || !errorMessage.trim()) {
    return {
      classification: "unknown",
      isRepairable: false,
      reason: "No error message provided to classify",
    };
  }

  const text = errorMessage.toLowerCase();

  // 1. Browser crashes / disconnections (non-repairable)
  if (
    text.includes("target page, context or browser has been closed") ||
    text.includes("browser has been closed") ||
    text.includes("browser has disconnected") ||
    text.includes("target closed") ||
    text.includes("crash") ||
    text.includes("sigsegv") ||
    text.includes("sigkill")
  ) {
    return {
      classification: "browser-crash",
      isRepairable: false,
      reason: "Browser crashed or disconnected during execution",
    };
  }

  // 2. Network failures (non-repairable)
  if (
    text.includes("net::err_") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("failed to fetch") ||
    text.includes("network error")
  ) {
    return {
      classification: "network-failure",
      isRepairable: false,
      reason: "Network or server connection failure",
    };
  }

  // 3. Authentication redirects & missing credentials (non-repairable)
  if (
    text.includes("missing credentials") ||
    text.includes("invalid credentials") ||
    text.includes("username or password incorrect") ||
    text.includes("auth credentials required") ||
    text.includes("no credentials provided")
  ) {
    return {
      classification: "missing-credentials",
      isRepairable: false,
      reason: "Required authentication credentials are missing or invalid",
    };
  }

  if (
    text.includes("401 unauthorized") ||
    text.includes("403 forbidden") ||
    text.includes("redirected to login") ||
    text.includes("redirected to /login") ||
    text.includes("/auth/login") ||
    text.includes("redirect to login")
  ) {
    return {
      classification: "auth-redirect",
      isRepairable: false,
      reason: "Application redirected to authentication or login page",
    };
  }

  // 4. Infrastructure failures (non-repairable)
  if (
    text.includes("spawn eacces") ||
    text.includes("spawn enoent") ||
    text.includes("playwright command failed to start") ||
    text.includes("cannot find module")
  ) {
    return {
      classification: "infrastructure-failure",
      isRepairable: false,
      reason: "Infrastructure or test runner environment failure",
    };
  }

  // 5. Genuine product assertion failures (non-repairable)
  // Check if it's an assertion where element was found but value/state differed
  const isAssertionError =
    text.includes("assertionerror") ||
    text.includes("expect(") ||
    text.includes("expected:") ||
    text.includes("tohavetext") ||
    text.includes("tobetruthy") ||
    text.includes("toequal");

  const isTimingOrLocator =
    text.includes("waiting for locator") ||
    text.includes("waiting for element") ||
    text.includes("timeout") ||
    text.includes("strict mode violation") ||
    text.includes("resolved to");

  if (isAssertionError && !isTimingOrLocator) {
    return {
      classification: "product-assertion",
      isRepairable: false,
      reason: "Genuine product assertion mismatch; test must not be weakened or skipped",
    };
  }

  // 6. Actionability and timing issues (repairable)
  if (
    text.includes("intercepts pointer events") ||
    text.includes("element is not visible") ||
    text.includes("element is not stable") ||
    text.includes("element is not enabled") ||
    text.includes("waiting for element to be visible") ||
    text.includes("waiting for actionability") ||
    (text.includes("timeout") && text.includes("waiting for locator"))
  ) {
    return {
      classification: "actionability-timing",
      isRepairable: true,
      reason: "Element actionability or timing condition was not met",
    };
  }

  // 7. Navigation readiness (repairable)
  if (
    text.includes("page.goto: timeout") ||
    text.includes("waiting for navigation") ||
    text.includes("waiting for load state") ||
    text.includes("load state 'load'") ||
    text.includes("load state 'networkidle'")
  ) {
    return {
      classification: "navigation-readiness",
      isRepairable: true,
      reason: "Page navigation or network readiness timed out",
    };
  }

  // 8. Fixture / setup defect (repairable)
  if (
    text.includes("typeerror: cannot read properties") ||
    text.includes("testdata is not defined") ||
    text.includes("referenceerror:")
  ) {
    return {
      classification: "fixture-defect",
      isRepairable: true,
      reason: "Test setup or data fixture defect",
    };
  }

  // 9. Selector drift (repairable)
  if (
    text.includes("strict mode violation") ||
    text.includes("resolved to") ||
    text.includes("could not find element") ||
    text.includes("no element matching") ||
    text.includes("waiting for locator") ||
    text.includes("locator.") ||
    text.includes("getbyrole") ||
    text.includes("getbytext") ||
    text.includes("getbytestid")
  ) {
    return {
      classification: "selector-drift",
      isRepairable: true,
      reason: "Locator changed or resolved to unexpected elements",
    };
  }

  // Fallback
  return {
    classification: "unknown",
    isRepairable: false,
    reason: "Unclassified failure requiring manual inspection",
  };
}

export function createUnifiedDiff(
  oldPath: string,
  newPath: string,
  oldContent: string,
  newContent: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diffLines: string[] = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ];

  const lengths = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIdx = oldLines.length - 1; oldIdx >= 0; oldIdx--) {
    for (let newIdx = newLines.length - 1; newIdx >= 0; newIdx--) {
      lengths[oldIdx]![newIdx] =
        oldLines[oldIdx] === newLines[newIdx]
          ? lengths[oldIdx + 1]![newIdx + 1]! + 1
          : Math.max(lengths[oldIdx + 1]![newIdx]!, lengths[oldIdx]![newIdx + 1]!);
    }
  }

  let oldIdx = 0;
  let newIdx = 0;
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (
      oldIdx < oldLines.length &&
      newIdx < newLines.length &&
      oldLines[oldIdx] === newLines[newIdx]
    ) {
      diffLines.push(` ${oldLines[oldIdx]}`);
      oldIdx++;
      newIdx++;
    } else if (
      newIdx >= newLines.length ||
      (oldIdx < oldLines.length && lengths[oldIdx + 1]![newIdx]! >= lengths[oldIdx]![newIdx + 1]!)
    ) {
      diffLines.push(`-${oldLines[oldIdx]}`);
      oldIdx++;
    } else {
      diffLines.push(`+${newLines[newIdx]}`);
      newIdx++;
    }
  }

  return diffLines.join("\n");
}
