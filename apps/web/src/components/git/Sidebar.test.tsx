import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NAV, Sidebar } from "./Sidebar";

const baseProps = {
  repoName: "tabs-app",
  panel: "changes" as const,
  setPanel: vi.fn(),
  setCollapsed: vi.fn(),
  changeCount: 3,
  idPrefix: "git-test",
};

describe("Git sidebar accessibility", () => {
  it.each([false, true])("connects every %s sidebar tab to its panel", (collapsed) => {
    const markup = renderToStaticMarkup(<Sidebar {...baseProps} collapsed={collapsed} />);

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Source control views"');
    for (const item of NAV) {
      expect(markup).toContain(`id="git-test-tab-${item.id}"`);
      expect(markup).toContain(`aria-controls="git-test-panel-${item.id}"`);
    }
    expect(markup).toContain('id="git-test-tab-changes" role="tab" aria-selected="true"');
    expect(markup).toContain('id="git-test-tab-overview" role="tab" aria-selected="false"');
  });

  it("gives collapsed icon-only controls accessible names", () => {
    const markup = renderToStaticMarkup(<Sidebar {...baseProps} collapsed />);

    expect(markup).toContain('aria-label="Expand source control sidebar"');
    expect(markup).toContain('aria-label="Overview. Repo health, quick actions, and sync status"');
  });
});
