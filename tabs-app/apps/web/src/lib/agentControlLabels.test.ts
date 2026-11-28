import { describe, expect, it } from "vitest";
import { physicalInputActivity } from "./agentPhysicalInputStore";
import { grantScopeQuestion } from "./threadSurfaceAttachment";

describe("grantScopeQuestion", () => {
  const page = new URL("https://app.test/tenant-1/drafts");
  it("says the whole origin is covered by default", () => {
    expect(grantScopeQuestion({}, page, "Work")).toBe(
      "Allow this conversation to read and act on all pages of https://app.test in the Work profile?",
    );
  });
  it("uses the desktop scope description when present", () => {
    expect(
      grantScopeQuestion(
        { browserPageScopeLabel: "all pages under https://app.test/org/x in the work profile" },
        page,
        "Work",
        "work",
      ),
    ).toBe(
      "Allow this conversation to read and act on all pages under https://app.test/org/x in the Work profile?",
    );
  });
});

describe("physicalInputActivity", () => {
  const grant = (mode: "agent" | "user") => ({ mode }) as never;
  it("reports only agent grants that use or need the foreground", () => {
    expect(physicalInputActivity({ grant: grant("agent"), activity: "foreground" })).toBe(
      "foreground",
    );
    expect(
      physicalInputActivity({ grant: grant("agent"), activity: "background" }),
    ).toBeUndefined();
    expect(physicalInputActivity({ grant: grant("user"), activity: "foreground" })).toBeUndefined();
    expect(physicalInputActivity({ grant: null, activity: "foreground" })).toBeUndefined();
  });
});
