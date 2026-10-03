import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageLoadingState } from "./PageLoadingState";

describe("PageLoadingState", () => {
  it("renders a centered Mercury loader with accessible contextual copy", () => {
    const markup = renderToStaticMarkup(
      <PageLoadingState label="Loading settings" detail="Preparing this section…" />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading settings"');
    expect(markup).toContain("Loading settings");
    expect(markup).toContain("Preparing this section…");
    expect(markup).toContain("ms-w1");
    expect(markup).toContain("ms-w4");
  });

  it("supports the compact page-section treatment", () => {
    const markup = renderToStaticMarkup(<PageLoadingState compact label="Loading usage" />);

    expect(markup).toContain("py-10");
    expect(markup).not.toContain("h-full py-16");
  });
});
