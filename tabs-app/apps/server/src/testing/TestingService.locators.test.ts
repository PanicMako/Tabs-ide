import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestingService } from "./TestingService";

describe("preview locator discovery", () => {
  it("captures the visible page, follows subpages, and preserves saved data on failed scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-preview-locators-"));
    const service = new TestingService(root);
    const dashboard = "https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index";
    const time =
      "https://opensource-demo.orangehrmlive.com/web/index.php/time/viewEmployeeTimesheet";
    try {
      const session = await service.startLocatorDiscovery({
        projectId: "preview-test",
        targetUrl: "https://www.google.com/",
        mode: "guided",
        scope: "page",
        coverage: "actions-assertions",
        safetyProfile: "read-only",
        maxElementsPerPage: 100,
        maxPagesPerSession: 2,
        previewSnapshot: {
          url: dashboard,
          snapshot: '- heading "Dashboard"\n- link "Time"\n- button "Old control"',
        },
      });
      expect(session.currentUrl).toBe(dashboard);
      expect(session.currentPageName).toBe("Dashboard page");
      expect(session.library.pages).toHaveLength(1);
      const second = await service.captureLocatorPage({
        projectId: "preview-test",
        sessionId: session.id,
        captureMode: "page",
        previewSnapshot: {
          url: time,
          snapshot: '- heading "Timesheets"\n- button "View"\n- textbox ""',
        },
      });
      expect(second.currentUrl).toBe(time);
      expect(second.currentPageName).toBe("View Employee Timesheet page");
      expect(second.library.pages).toHaveLength(2);
      const rescan = await service.captureLocatorPage({
        projectId: "preview-test",
        sessionId: session.id,
        captureMode: "page",
        previewSnapshot: {
          url: dashboard,
          snapshot: '- heading "Dashboard"\n- link "Time"\n- button "New control"',
        },
      });
      expect(rescan.status).toBe("running");
      expect(rescan.capturedPages).toBe(2);
      const page = rescan.library.pages.find((item) => item.urlPattern === dashboard)!;
      expect(
        page.entries.find((entry) => entry.arguments.name === "Old control")?.lifecycleStatus,
      ).toBe("archived");
      expect(
        page.entries.find((entry) => entry.arguments.name === "New control")?.lifecycleStatus,
      ).toBe("draft");
      await expect(
        service.captureLocatorPage({ projectId: "preview-test", sessionId: session.id }),
      ).rejects.toThrow("preview");
      const finished = await service.finishLocatorDiscovery({
        projectId: "preview-test",
        sessionId: session.id,
      });
      expect(finished.library.pages).toHaveLength(2);
      expect(finished.library.pages.find((item) => item.id === page.id)?.entries).toEqual(
        page.entries,
      );
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
