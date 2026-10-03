import { expect, it } from "vitest";
import { BrowserInputGuard } from "./browserInputGuard";
it("ignores only the matching injected event and consumes it once", () => {
  const guard = new BrowserInputGuard();
  guard.expect({ type: "mouseDown", x: 20, y: 30, zoom: 2 });
  expect(guard.consume({ type: "keyDown", key: "Escape" })).toBe(false);
  expect(guard.consume({ type: "mouseDown", x: 90, y: 30 })).toBe(false);
  expect(guard.consume({ type: "mouseDown", x: 40, y: 60 })).toBe(true);
  expect(guard.consume({ type: "mouseDown", x: 40, y: 60 })).toBe(false);
});
it("removes failed dispatch expectations and does not suppress other keyboard input", () => {
  const guard = new BrowserInputGuard();
  const release = guard.expect({ type: "keyDown", key: "Enter" });
  expect(guard.consume({ type: "keyDown", key: "a" })).toBe(false);
  release();
  expect(guard.consume({ type: "keyDown", key: "Enter" })).toBe(false);
});
