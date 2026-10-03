import { describe, expect, it } from "vitest";
import { createDefaultProjectWorkspaceSettings } from "../../workspaceShellStore";
import { removeBrowserProfileAssignments } from "./browserProfileAssignments";

describe("removeBrowserProfileAssignments", () => {
  it("migrates the project browser and matching embeds to project-shared storage", () => {
    const defaults = createDefaultProjectWorkspaceSettings();
    const result = removeBrowserProfileAssignments(
      {
        ...defaults,
        browser: {
          ...defaults.browser,
          partitionMode: "profile",
          partitionProfile: "client-a",
        },
        customEmbeds: [
          {
            id: "mail",
            label: "Mail",
            url: "https://mail.example.com",
            resumeLastVisitedPage: false,
            partitionMode: "profile",
            partitionProfile: "client-a",
          },
          {
            id: "docs",
            label: "Docs",
            url: "https://docs.example.com",
            resumeLastVisitedPage: false,
            partitionMode: "profile",
            partitionProfile: "other",
          },
        ],
      },
      "client-a",
    );

    expect(result.browser.partitionMode).toBe("shared");
    expect(result.browser).not.toHaveProperty("partitionProfile");
    expect(result.customEmbeds[0]).toMatchObject({ partitionMode: "shared" });
    expect(result.customEmbeds[0]).not.toHaveProperty("partitionProfile");
    expect(result.customEmbeds[1]).toMatchObject({
      partitionMode: "profile",
      partitionProfile: "other",
    });
  });
});
