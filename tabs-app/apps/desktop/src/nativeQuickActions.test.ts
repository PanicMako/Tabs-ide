import { EventEmitter } from "node:events";
import type { App, BrowserWindow, Input, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { parseKeybindingShortcut } from "@tabs/shared/keybindings";
import {
  installNativeQuickActionsForwarding,
  matchesNativeQuickActionsInput,
} from "./nativeQuickActions";

const chord = parseKeybindingShortcut("mod+alt+k")!;
const input = (patch: Partial<Input> = {}): Input =>
  ({
    type: "keyDown",
    key: "˚",
    code: "KeyK",
    meta: true,
    control: false,
    alt: true,
    shift: false,
    isAutoRepeat: false,
    isComposing: false,
    ...patch,
  }) as Input;
const contents = () => new EventEmitter() as EventEmitter & WebContents;
const windowWith = (main: WebContents, views: WebContents[]): BrowserWindow =>
  ({
    isDestroyed: () => false,
    webContents: main,
    contentView: {
      children: [{ children: views.map((webContents) => ({ webContents, children: [] })) }],
    },
  }) as unknown as BrowserWindow;

describe("native Quick Actions input", () => {
  it("matches the shared layout-aware chord on Mac and Windows", () => {
    expect(matchesNativeQuickActionsInput(input(), chord, "darwin")).toBe(true);
    expect(matchesNativeQuickActionsInput(input({ key: "Dead" }), chord, "darwin")).toBe(true);
    expect(
      matchesNativeQuickActionsInput(
        input({ key: "k", meta: false, control: true }),
        chord,
        "win32",
      ),
    ).toBe(true);
    expect(matchesNativeQuickActionsInput(input({ key: "x" }), chord, "darwin")).toBe(false);
    expect(matchesNativeQuickActionsInput(input({ shift: true }), chord, "darwin")).toBe(false);
    expect(matchesNativeQuickActionsInput(input({ alt: false }), chord, "darwin")).toBe(false);
  });
  it("leaves key releases, repeats and composition untouched", () => {
    for (const event of [
      input({ type: "keyUp" }),
      input({ isAutoRepeat: true }),
      input({ isComposing: true }),
    ])
      expect(matchesNativeQuickActionsInput(event, chord, "darwin")).toBe(false);
    expect(matchesNativeQuickActionsInput(input(), undefined, "darwin")).toBe(false);
  });
  it("forwards attached Code/browser/embedded terminal chords exactly once to their owner", () => {
    const app = new EventEmitter();
    const root = contents(),
      code = contents(),
      browser = contents(),
      unknown = contents();
    const owner = windowWith(root, [code, browser]);
    const forward = vi.fn();
    const dispose = installNativeQuickActionsForwarding({
      app: app as unknown as App,
      getWindows: () => [owner],
      getShortcut: () => chord,
      forward,
      platform: "darwin",
    });
    for (const target of [root, code, browser, unknown])
      app.emit("web-contents-created", {}, target);
    for (const target of [code, browser]) {
      const event = { preventDefault: vi.fn() };
      target.emit("before-input-event", event, input());
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(forward.mock.calls).toEqual([[owner], [owner]]);
    for (const target of [root, unknown]) {
      const event = { preventDefault: vi.fn() };
      target.emit("before-input-event", event, input());
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(forward).toHaveBeenCalledTimes(2);
    code.emit("destroyed");
    expect(code.listenerCount("before-input-event")).toBe(0);
    dispose();
    expect(app.listenerCount("web-contents-created")).toBe(0);
    expect(browser.listenerCount("before-input-event")).toBe(0);
  });
  it("reads shortcut changes without capturing a stale binding", () => {
    const app = new EventEmitter(),
      root = contents(),
      code = contents();
    let shortcut = chord;
    const forward = vi.fn();
    const dispose = installNativeQuickActionsForwarding({
      app: app as unknown as App,
      getWindows: () => [windowWith(root, [code])],
      getShortcut: () => shortcut,
      forward,
      platform: "darwin",
    });
    app.emit("web-contents-created", {}, code);
    shortcut = parseKeybindingShortcut("mod+alt+j")!;
    code.emit("before-input-event", { preventDefault: vi.fn() }, input());
    expect(forward).not.toHaveBeenCalled();
    code.emit("before-input-event", { preventDefault: vi.fn() }, input({ key: "j", code: "KeyJ" }));
    expect(forward).toHaveBeenCalledOnce();
    dispose();
  });
});
