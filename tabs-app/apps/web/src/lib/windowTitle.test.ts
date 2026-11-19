import { describe, expect, it } from "vitest";
import { windowTitleFor } from "./windowTitle";

describe("windowTitleFor", () => {
  it("puts the thread title before the app name", () => {
    expect(windowTitleFor({ threadTitle: "Fix the sidebar", appName: "Tabs" })).toBe(
      "Fix the sidebar — Tabs",
    );
  });

  it("leads with what needs attention", () => {
    expect(
      windowTitleFor({ threadTitle: "Fix the sidebar", status: "needs-input", appName: "Tabs" }),
    ).toBe("Needs your input · Fix the sidebar — Tabs");
    expect(
      windowTitleFor({ threadTitle: "Fix the sidebar", status: "working", appName: "Tabs" }),
    ).toBe("Working · Fix the sidebar — Tabs");
  });

  it("is just the app name for an untitled idle thread", () => {
    expect(windowTitleFor({ threadTitle: "  ", appName: "Tabs" })).toBe("Tabs");
    expect(windowTitleFor({ appName: "Tabs" })).toBe("Tabs");
  });

  it("shows the status alone when there is no title yet", () => {
    expect(windowTitleFor({ threadTitle: "", status: "working", appName: "Tabs" })).toBe(
      "Working — Tabs",
    );
  });

  it("shortens very long titles", () => {
    const title = windowTitleFor({ threadTitle: "x".repeat(100), appName: "Tabs" });
    expect(title).toBe(`${"x".repeat(59)}… — Tabs`);
  });
});
