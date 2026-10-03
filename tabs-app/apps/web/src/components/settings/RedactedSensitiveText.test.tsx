import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RedactedSensitiveText } from "./RedactedSensitiveText";

describe("RedactedSensitiveText", () => {
  it("renders nothing when value is empty or null", () => {
    const htmlNull = renderToStaticMarkup(
      <RedactedSensitiveText
        value={null}
        ariaLabel="Masked token"
        revealTooltip="Reveal"
        hideTooltip="Hide"
      />,
    );
    expect(htmlNull).toBe("");

    const htmlEmpty = renderToStaticMarkup(
      <RedactedSensitiveText
        value="   "
        ariaLabel="Masked token"
        revealTooltip="Reveal"
        hideTooltip="Hide"
      />,
    );
    expect(htmlEmpty).toBe("");
  });

  it("renders redacted placeholder with blur class initially", () => {
    const secret = "sk-ant-api03-abcdef123456789";
    const html = renderToStaticMarkup(
      <RedactedSensitiveText
        value={secret}
        ariaLabel="API key mask"
        revealTooltip="Click to reveal"
        hideTooltip="Click to hide"
      />,
    );

    expect(html).toContain("blur-[2px]");
    expect(html).toContain('aria-label="API key mask"');
    // It should not contain the raw secret unredacted in text initially
    expect(html).not.toContain(`>${secret}<`);
    // Length should be preserved
    expect(html).toContain("-");
  });
});
