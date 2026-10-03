import { TextGenerationError } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import type { TextGenerationShape } from "./TextGeneration";

export function makeUnsupportedTextGeneration(providerName: string): TextGenerationShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation: operation as TextGenerationError["operation"],
        detail: `${providerName} does not expose a standalone text-generation API.`,
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateDiffSummary: () => unsupported("generateDiffSummary"),
    generateStructuredTesting: () => unsupported("generateStructuredTesting"),
  } as TextGenerationShape;
}
