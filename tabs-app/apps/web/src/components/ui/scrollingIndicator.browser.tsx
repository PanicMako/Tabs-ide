import { afterEach, describe, expect, it, vi } from "vitest";
import { installScrollingIndicator } from "../../lib/scrollingIndicator";

describe("installScrollingIndicator", () => {
  afterEach(() => vi.useRealTimers());

  it("flags a scroller while it scrolls and clears it after it settles", () => {
    vi.useFakeTimers();
    const el = document.createElement("div");
    document.body.append(el);
    const dispose = installScrollingIndicator();
    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute("data-scrolling")).toBe(true);
    vi.advanceTimersByTime(500);
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(600);
    expect(el.hasAttribute("data-scrolling")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(el.hasAttribute("data-scrolling")).toBe(false);
    dispose();
    el.remove();
  });

  it("stops listening and cleans up on dispose", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const dispose = installScrollingIndicator();
    el.dispatchEvent(new Event("scroll"));
    dispose();
    expect(el.hasAttribute("data-scrolling")).toBe(false);
    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute("data-scrolling")).toBe(false);
    el.remove();
  });
});
