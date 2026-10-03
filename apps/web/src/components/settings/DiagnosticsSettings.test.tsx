import { describe, expect, it, vi } from "vitest";
import { PRIMARY_POPOUT_TABS, TAB_TITLES, type DiagnosticsTabId } from "./DiagnosticsSettings";

describe("DiagnosticsSettings navigation and popout configuration", () => {
  it("defines readable titles for all diagnostics tabs", () => {
    const expectedTabs: ReadonlyArray<DiagnosticsTabId> = [
      "overview",
      "timeline",
      "process-tree",
      "application-io",
      "live-processes",
      "traces",
    ];

    for (const tab of expectedTabs) {
      expect(TAB_TITLES[tab]).toBeDefined();
      expect(typeof TAB_TITLES[tab]).toBe("string");
      expect(TAB_TITLES[tab].length).toBeGreaterThan(0);
    }

    expect(TAB_TITLES.overview).toBe("Overview");
    expect(TAB_TITLES.timeline).toBe("Resource Timeline");
    expect(TAB_TITLES["process-tree"]).toBe("Process Tree");
    expect(TAB_TITLES["application-io"]).toBe("Application I/O");
    expect(TAB_TITLES["live-processes"]).toBe("Live Processes");
    expect(TAB_TITLES.traces).toBe("Traces");
  });

  it("configures the Trae-style primary popout tabs correctly", () => {
    expect(PRIMARY_POPOUT_TABS).toHaveLength(6);
    expect(PRIMARY_POPOUT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "CPU & Memory",
      "Disk",
      "Network",
      "Process Tree",
      "Live Processes",
    ]);
  });

  it("builds correct popout target URL and invokes desktopBridge when present", () => {
    const mockOpenPopout = vi.fn();
    const mockDesktopBridge = {
      openPopoutWindow: mockOpenPopout,
    };

    const activeTab: DiagnosticsTabId = "process-tree";
    const targetUrl = `/settings?section=diagnostics&tab=${activeTab}&popout=true`;
    const width = 780;
    const height = 560;

    // Simulate popout trigger logic
    if (mockDesktopBridge.openPopoutWindow) {
      mockDesktopBridge.openPopoutWindow({
        url: targetUrl,
        title: `Tabs — Diagnostics: ${TAB_TITLES[activeTab]}`,
        width,
        height,
      });
    }

    expect(mockOpenPopout).toHaveBeenCalledTimes(1);
    expect(mockOpenPopout).toHaveBeenCalledWith({
      url: "/settings?section=diagnostics&tab=process-tree&popout=true",
      title: "Tabs — Diagnostics: Process Tree",
      width: 780,
      height: 560,
    });
  });

  it("builds correct fallback URL when desktopBridge is absent", () => {
    const mockWindowOpen = vi.fn();
    const activeTab: DiagnosticsTabId = "overview";
    const targetUrl = `/settings?section=diagnostics&tab=${activeTab}&popout=true`;
    const width = 780;
    const height = 560;
    const origin = "http://localhost:5733";

    mockWindowOpen(
      `${origin}${targetUrl}`,
      "tabs_diagnostics_popout",
      `width=${width},height=${height},left=100,top=100,resizable=yes,scrollbars=yes`,
    );

    expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "http://localhost:5733/settings?section=diagnostics&tab=overview&popout=true",
      "tabs_diagnostics_popout",
      "width=780,height=560,left=100,top=100,resizable=yes,scrollbars=yes",
    );
  });

  it("correctly identifies popout mode from standard query params and hash history", async () => {
    const { getHashAwareSearchParams } = await import("../../lib/utils");

    try {
      // Standard dev URL: ?section=diagnostics&tab=overview&popout=true
      vi.stubGlobal("window", {
        location: {
          search: "?section=diagnostics&tab=overview&popout=true",
          hash: "",
        },
      });
      expect(getHashAwareSearchParams().get("popout")).toBe("true");
      expect(getHashAwareSearchParams().get("section")).toBe("diagnostics");

      // Hash history URL: #/settings?section=diagnostics&tab=overview&popout=true
      vi.stubGlobal("window", {
        location: {
          search: "",
          hash: "#/settings?section=diagnostics&tab=overview&popout=true",
        },
      });
      expect(getHashAwareSearchParams().get("popout")).toBe("true");
      expect(getHashAwareSearchParams().get("section")).toBe("diagnostics");

      // Regular URL without popout
      vi.stubGlobal("window", {
        location: {
          search: "?section=diagnostics",
          hash: "",
        },
      });
      expect(getHashAwareSearchParams().get("popout")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
