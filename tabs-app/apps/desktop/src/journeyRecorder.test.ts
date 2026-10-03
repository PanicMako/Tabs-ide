import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { JourneyRecorder, journeyCode } from "./journeyRecorder";

function fixture() {
  const debug = Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => false),
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(async () => ({ identifier: "script-1" })),
  });
  const contents = Object.assign(new EventEmitter(), {
    debugger: debug,
    getURL: () => "https://example.com/start?token=secret",
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async () => undefined),
  });
  return {
    debug,
    contents,
    recorder: new JourneyRecorder(contents as unknown as WebContents),
  };
}

describe("embedded journey recorder", () => {
  it("cleans listeners and injected script after repeated recording", async () => {
    const { debug, contents, recorder } = fixture();
    for (let index = 0; index < 3; index++) {
      await recorder.start();
      expect(debug.listenerCount("message")).toBe(1);
      const output = await recorder.stop();
      expect(output.code).not.toContain("token=secret");
      expect(debug.listenerCount("message")).toBe(0);
      expect(contents.listenerCount("destroyed")).toBe(0);
    }
    expect(debug.sendCommand).toHaveBeenCalledWith("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: "script-1",
    });
  });
  it("cleans up a failed injection", async () => {
    const { recorder, debug, contents } = fixture();
    contents.executeJavaScript.mockRejectedValueOnce(new Error("navigation interrupted"));
    await expect(recorder.start()).rejects.toThrow("navigation interrupted");
    expect(debug.listenerCount("message")).toBe(0);
    expect(recorder.status().recording).toBe(false);
  });
  it("preserves the actual test-id attribute in recorded selectors", async () => {
    const { recorder, debug } = fixture();
    await recorder.start();
    const injection = debug.sendCommand.mock.calls.find(
      (call: unknown) => Array.isArray(call) && call[0] === "Page.addScriptToEvaluateOnNewDocument",
    ) as [string, { source: string }] | undefined;
    expect(injection?.[1].source).toContain("['data-testid', 'data-test', 'data-cy']");
    expect(injection?.[1].source).toContain("'[' + testIdAttribute");
    await recorder.stop();
  });
  it("exports placeholders and an explicit assertion-review guard", () => {
    const code = journeyCode("https://example.com", [
      { action: "fill", selector: "input:nth-of-type(1)" },
      { action: "click", selector: "button" },
    ]);
    expect(code).toContain("TEST_INPUT_1");
    expect(code).toContain('throw new Error("Add an assertion');
    expect(code).not.toContain("test.skip");
  });

  it("supports extended actions and business assertions in generated code", () => {
    const code = journeyCode("https://example.com/app", [
      { action: "goto", url: "https://example.com/login" },
      { action: "fill", selector: 'input[name="user"]', value: "admin" },
      { action: "press", selector: 'input[name="user"]', key: "Enter" },
      { action: "check", selector: 'input[type="checkbox"]' },
      { action: "uncheck", selector: 'input[type="checkbox"]' },
      { action: "selectOption", selector: "select#role", value: "manager" },
      { action: "click", selector: "button#submit" },
      { action: "assertVisible", selector: "h1.dashboard" },
      {
        action: "assertText",
        selector: "h1.dashboard",
        expectedValue: "Welcome Admin",
      },
      {
        action: "assertValue",
        selector: "input#status",
        expectedValue: "Active",
      },
    ]);
    expect(code).toContain('await page.goto("https://example.com/login");');
    expect(code).toContain('.fill("admin");');
    expect(code).toContain('.press("Enter");');
    expect(code).toContain(".check();");
    expect(code).toContain(".uncheck();");
    expect(code).toContain('.selectOption("manager");');
    expect(code).toContain(".click();");
    expect(code).toContain('await expect(page.locator("h1.dashboard")).toBeVisible();');
    expect(code).toContain(
      'await expect(page.locator("h1.dashboard")).toHaveText("Welcome Admin");',
    );
    expect(code).toContain('await expect(page.locator("input#status")).toHaveValue("Active");');
    // Guard is omitted because business assertions were reviewed and provided
    expect(code).not.toContain('throw new Error("Add an assertion');
  });

  it("deduplicates consecutive fill messages and tracks in-preview navigation", async () => {
    const { debug, contents, recorder } = fixture();
    await recorder.start();

    const addBindingCall = debug.sendCommand.mock.calls.find(
      (call: unknown) => Array.isArray(call) && call[0] === "Runtime.addBinding",
    ) as [string, { name: string }] | undefined;
    const bindingName = addBindingCall?.[1]?.name ?? "__tabsJourneyRecorder";

    // Simulate 2 fills on the same selector (e.g. input + change event)
    debug.emit("message", {}, "Runtime.bindingCalled", {
      name: bindingName,
      payload: JSON.stringify({ action: "fill", selector: "input#search" }),
    });
    debug.emit("message", {}, "Runtime.bindingCalled", {
      name: bindingName,
      payload: JSON.stringify({ action: "fill", selector: "input#search" }),
    });
    // And Enter key press
    debug.emit("message", {}, "Runtime.bindingCalled", {
      name: bindingName,
      payload: JSON.stringify({
        action: "press",
        selector: "input#search",
        key: "Enter",
      }),
    });

    // Simulate in-preview navigation
    contents.emit("did-navigate", {}, "https://example.com/results?q=test");

    const result = await recorder.stop();
    // Result should have only 1 fill, 1 press, and 1 goto (deduplicated)
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]?.action).toBe("fill");
    expect(result.steps[1]?.action).toBe("press");
    expect(result.steps[2]?.action).toBe("goto");
    expect(result.steps[2]?.url).toBe("https://example.com/results");
    // URL sanitization stripped query parameter
    expect(result.steps[2]?.url).not.toContain("q=test");
  });
});
