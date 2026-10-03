import type { ReviewFinding } from "@tabs/contracts";

export const TEST_REVIEW_FINDING = {
  id: "finding-1",
  file: "src/example.ts",
  line: 12,
  category: "correctness",
  severity: "warning",
  title: "Preserve generated finding",
  body: "The structured review finding must reach the review runner.",
  confidence: 0.9,
  isInDiff: true,
} satisfies ReviewFinding;
