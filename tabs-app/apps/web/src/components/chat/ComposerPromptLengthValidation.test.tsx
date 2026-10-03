import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@tabs/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";
import { getComposerPromptLengthValidationMessage } from "./composerSubmission";

describe("ComposerPromptLengthValidation", () => {
  it("renders actionable oversized-prompt feedback as an alert", () => {
    const markup = renderToStaticMarkup(
      <ComposerPromptLengthValidation
        message={getComposerPromptLengthValidationMessage(
          "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1),
        )}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-chat-composer-validation="prompt-length"');
    expect(markup).toContain("Prompt is 1 character over");
  });
});
