import "../../index.css";
import "./teammates.css";

import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { DockFace, type DockMember } from "./TeammateDock";

const member = (id: string, name: string, waiting = 0): DockMember => ({
  id,
  name,
  mood: waiting > 0 ? "needsYou" : "idle",
  waiting,
});

describe("DockFace", () => {
  it("is just a pair of eyes for one teammate", async () => {
    await render(<DockFace members={[member("a", "Juno")]} />);
    expect(document.querySelectorAll(".tm-dock-eyes")).toHaveLength(1);
    expect(document.querySelector(".tm-dock-text")).toBeNull();
  });

  it("adds a quiet count of the others when several are minimised", async () => {
    await render(
      <div data-testid="dock">
        <DockFace members={[member("a", "Juno"), member("b", "Nova"), member("c", "Quill")]} />
      </div>,
    );
    await expect.element(page.getByTestId("dock")).toHaveTextContent("+2");
    expect(document.querySelectorAll(".tm-dock-eyes")).toHaveLength(1);
  });

  it("widens the eyes of a teammate that needs you", async () => {
    await render(<DockFace members={[member("a", "Juno", 2)]} />);
    expect(document.querySelector(".tm-dock-eyes")!.getAttribute("data-attention")).toBe("true");
  });

  it("turns its eyes toward the cursor, narrowing the far eye, and settles back at rest", async () => {
    await render(<DockFace members={[member("a", "Juno")]} />);
    const eyes = document.querySelector<HTMLElement>(".tm-dock-eyes")!;
    const [near, far] = Array.from(eyes.children) as HTMLElement[];
    const box = eyes.getBoundingClientRect();
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: box.left + 400,
        clientY: box.top + box.height / 2,
      }),
    );
    await expect.poll(() => parseFloat(eyes.style.translate)).toBeGreaterThan(2.5);
    // Looking right: the left eye is the far one and narrows.
    expect(parseFloat(near!.style.scale)).toBeLessThan(0.95);
    expect(parseFloat(far!.style.scale)).toBeCloseTo(1, 1);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: box.left - 400, clientY: box.top - 400 }),
    );
    await expect.poll(() => parseFloat(eyes.style.translate)).toBeLessThan(-1.5);
  });
});
