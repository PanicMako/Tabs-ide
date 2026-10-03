import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedHeight } from "./AnimatedHeight";

describe("AnimatedHeight", () => {
  it("renders children wrapped inside data-slot container", () => {
    const html = renderToStaticMarkup(
      <AnimatedHeight>
        <div id="test-child">Collapsible Content</div>
      </AnimatedHeight>,
    );

    expect(html).toContain('data-slot="animated-height"');
    expect(html).toContain('id="test-child"');
    expect(html).toContain("Collapsible Content");
    expect(html).toContain("transition-[height]");
  });
});
