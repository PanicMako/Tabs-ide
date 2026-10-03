import { describe, expect, it } from "vitest";
import type { TestingLocatorDiscoverySession } from "@tabs/contracts";
import {
  locatorPageForCapture,
  locatorPreviewSnapshot,
  normalizeLocatorUrl,
} from "./locatorPreview";

describe("locator preview", () => {
  it("selects the captured URL, never the first historical page", () => {
    const result = {
      currentUrl: "https://example.com/dashboard",
      library: {
        pages: [
          { id: "google", urlPattern: "https://www.google.com/" },
          { id: "dashboard", urlPattern: "https://example.com/dashboard" },
        ],
      },
    } as unknown as TestingLocatorDiscoverySession;
    expect(locatorPageForCapture(result)?.id).toBe("dashboard");
    expect(
      locatorPageForCapture({ ...result, currentUrl: "https://example.com/missing" }),
    ).toBeUndefined();
  });
  it("serializes actual accessible names and rejects incomplete captures", () => {
    expect(
      locatorPreviewSnapshot({
        url: "https://example.com/time",
        accessibilityTree: {
          nodes: [
            { role: { value: "button" }, name: { value: 'View "time"' } },
            { role: { value: "textbox" }, name: { value: "" } },
            { ignored: true, role: { value: "button" }, name: { value: "Hidden" } },
          ],
        },
      }),
    ).toEqual({
      url: "https://example.com/time",
      snapshot: '- button "View \\"time\\""\n- textbox ""',
    });
    expect(() => locatorPreviewSnapshot({ url: "https://example.com", loading: true })).toThrow(
      "finish loading",
    );
    expect(() => locatorPreviewSnapshot({ url: "https://example.com" })).toThrow(
      "accessibility tree",
    );
  });
  it("only commits complete HTTP URLs", () => {
    expect(normalizeLocatorUrl(" https://example.com ")).toBe("https://example.com/");
    expect(() => normalizeLocatorUrl("https://")).toThrow();
    expect(() => normalizeLocatorUrl("javascript:alert(1)")).toThrow("HTTP");
  });
});
