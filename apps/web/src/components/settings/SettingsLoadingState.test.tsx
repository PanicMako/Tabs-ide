import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsLoadingState } from "./SettingsLoadingState";

describe("SettingsLoadingState", () => {
  it("renders a compact accessible glint without the Mercury loader", () => {
    const markup = renderToStaticMarkup(<SettingsLoadingState label="Loading Providers" />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading Providers"');
    expect(markup).toContain("settings-loading-glint");
    expect(markup).not.toContain("ms-w1");
  });
});
