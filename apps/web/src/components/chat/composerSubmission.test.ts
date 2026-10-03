import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { getComposerPromptLengthValidationMessage } from "./composerSubmission";

describe("getComposerPromptLengthValidationMessage", () => {
  it("allows input at the provider contract limit", () => {
    expect(
      getComposerPromptLengthValidationMessage("x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    ).toBeNull();
  });

  it("explains exactly how far oversized input exceeds the limit", () => {
    expect(
      getComposerPromptLengthValidationMessage(
        `  ${"x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1)}  `,
      ),
    ).toBe(
      "Prompt is 1 character over the 120,000-character limit. Shorten or split it before sending.",
    );
  });
});
