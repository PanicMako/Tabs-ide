import { afterEach, describe, expect, it, vi } from "vitest";
import { probeServerReadiness } from "./ServerReadinessBadge";

afterEach(() => vi.unstubAllGlobals());
describe("renderer readiness bridge", () => {
  it.each(["https://github.com/pulls", "not-a-valid-url"])(
    "does not probe non-local targets: %s",
    async (url) => {
      expect((await probeServerReadiness(url)).state).toBe("not_local");
    },
  );
  it("uses the desktop result without a renderer fetch or fabricated status", async () => {
    const probe = vi.fn().mockResolvedValue({ state: "unhealthy", httpStatus: 500 });
    const fetcher = vi.fn();
    vi.stubGlobal("window", { desktopBridge: { probeBrowserReadiness: probe } });
    vi.stubGlobal("fetch", fetcher);
    expect(await probeServerReadiness("http://localhost:5173/broken")).toEqual({
      state: "unhealthy",
      httpStatus: 500,
    });
    expect(probe).toHaveBeenCalledWith({ url: "http://localhost:5173/broken", timeoutMs: 2500 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports unknown if the privileged probe is unavailable", async () => {
    vi.stubGlobal("window", {});
    expect((await probeServerReadiness("http://127.0.0.1:3000")).state).toBe("unknown");
  });
});
