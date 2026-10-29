import { describe, expect, it } from "vitest";
import { resolveWorkspaceCardDensity } from "./workspaceCardDensity";

describe("resolveWorkspaceCardDensity", () => {
  it("resolves to full on wide, tall screens without split", () => {
    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 900,
        windowWidth: 1440,
        isSplitActive: false,
      }),
    ).toBe("full");
  });

  it("resolves to compact when split view is active", () => {
    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 900,
        windowWidth: 1440,
        isSplitActive: true,
      }),
    ).toBe("compact");
  });

  it("resolves to compact on medium window height or width", () => {
    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 650,
        windowWidth: 1200,
        isSplitActive: false,
      }),
    ).toBe("compact");

    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 800,
        windowWidth: 900,
        isSplitActive: false,
      }),
    ).toBe("compact");
  });

  it("resolves to essential on short window heights (< 540px)", () => {
    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 500,
        windowWidth: 1200,
        isSplitActive: false,
      }),
    ).toBe("essential");

    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 480,
        windowWidth: 1440,
        isSplitActive: true,
      }),
    ).toBe("essential");
  });

  it("respects card height constraint when provided", () => {
    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 800,
        windowWidth: 1200,
        cardHeight: 350,
      }),
    ).toBe("essential");

    expect(
      resolveWorkspaceCardDensity({
        windowHeight: 800,
        windowWidth: 1200,
        cardHeight: 500,
      }),
    ).toBe("compact");
  });
});
