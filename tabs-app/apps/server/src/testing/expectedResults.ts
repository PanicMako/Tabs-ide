export function alignExpectedResults(
  steps: ReadonlyArray<string>,
  expectedResults: ReadonlyArray<string> | undefined,
  legacyExpectedResult = "",
): ReadonlyArray<string> {
  if (steps.length === 0) return [];
  if (expectedResults !== undefined) {
    return steps.map((_, index) => expectedResults[index]?.trim() ?? "");
  }
  const legacy = legacyExpectedResult.trim();
  if (!legacy) return steps.map(() => "");
  const parsed = legacy
    .replace(/\r\n?/g, "\n")
    .split(/\n|(?=\s*\d+[.)]\s+)/)
    .map((result) => result.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  if (parsed.length > 1) {
    return steps.map((_, index) => parsed[index] ?? "");
  }
  return steps.map((_, index) => (index === steps.length - 1 ? legacy : ""));
}

export function summarizeExpectedResults(expectedResults: ReadonlyArray<string>): string {
  return expectedResults.filter((result) => result.trim()).join("\n");
}

export function normalizeStepExpectedResults(
  steps: ReadonlyArray<string>,
  expectedResults: ReadonlyArray<string> | undefined,
  legacyExpectedResult = "",
): { readonly steps: ReadonlyArray<string>; readonly expectedResults: ReadonlyArray<string> } {
  const populated = steps
    .map((step, index) => ({ step: step.trim(), expectedResult: expectedResults?.[index] ?? "" }))
    .filter((item) => item.step);
  const normalizedSteps = populated.map((item) => item.step);
  return {
    steps: normalizedSteps,
    expectedResults:
      expectedResults === undefined
        ? alignExpectedResults(normalizedSteps, undefined, legacyExpectedResult)
        : populated.map((item) => item.expectedResult.trim()),
  };
}
