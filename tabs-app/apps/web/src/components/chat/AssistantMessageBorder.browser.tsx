import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AssistantMessageBorder } from "./AssistantMessageBorder";

function Reply({ height }: { height: number }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} data-scroll style={{ height: 300, overflow: "auto" }}>
      <AssistantMessageBorder scrollContainer={container}>
        <div style={{ height }}>A response that continues as the model streams.</div>
      </AssistantMessageBorder>
      <div style={{ height: 1000 }} />
    </div>
  );
}

it("lights the visible portion of a reply and expands as user scrolls through", async () => {
  const view = await render(<Reply height={1000} />);
  try {
    const scroll = view.container.querySelector<HTMLElement>("[data-scroll]")!;
    const rail = view.container.querySelector<HTMLElement>("[data-assistant-rail]")!;
    const beam = view.container.querySelector<HTMLElement>("[data-assistant-rail-beam]")!;

    // At scrollTop 0 with height 1000 and viewport 300 (45% viewport = 135px):
    // rawProgress = 135 / 1000 = 0.135 (> 0.05), so it is actively scrolled
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
    await expect.poll(() => rail.dataset.railActive).toBe("true");

    const initialHeight = beam.getBoundingClientRect().height;
    expect(initialHeight).toBeGreaterThan(0);

    // Scroll further down into the message
    scroll.scrollTop = 400;
    scroll.dispatchEvent(new Event("scroll"));

    // Beam height grows with scroll progress
    await expect.poll(() => beam.getBoundingClientRect().height).toBeGreaterThan(initialHeight);
    expect(rail.dataset.railActive).toBe("true");

    // Scroll past the reply into the bottom spacer
    scroll.scrollTop = 1100;
    scroll.dispatchEvent(new Event("scroll"));
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("0");
    expect(rail.dataset.railActive).toBe("false");
  } finally {
    await view.unmount();
  }
});

it("triggers single-pass hover sweep on mouse enter when idle", async () => {
  function HoverableReply() {
    const [container, setContainer] = useState<HTMLDivElement | null>(null);
    return (
      <div ref={setContainer} data-scroll style={{ height: 600, overflow: "auto" }}>
        {/* Placed at 280px within a 600px viewport (elementTop = 280 > 45% viewport = 270), so rawProgress <= 0 */}
        <div style={{ height: 280 }} />
        <AssistantMessageBorder scrollContainer={container}>
          <div style={{ height: 300 }}>Static message</div>
        </AssistantMessageBorder>
      </div>
    );
  }

  const view = await render(<HoverableReply />);
  try {
    const rail = view.container.querySelector<HTMLElement>("[data-assistant-rail]")!;
    const sweep = view.container.querySelector<HTMLElement>("[data-assistant-rail-sweep]")!;
    expect(sweep).toBeTruthy();
    expect(getComputedStyle(sweep).opacity).toBe("0");
    expect(rail.dataset.railActive).toBe("false");

    // Hover triggers GSAP sweep
    const railLocator = page.getByTestId("assistant-rail");
    await userEvent.hover(railLocator);
    await expect.poll(() => Number(getComputedStyle(sweep).opacity)).toBeGreaterThan(0);
  } finally {
    await view.unmount();
  }
});

it("remeasures when streaming changes the reply height without a scroll event", async () => {
  const view = await render(<Reply height={600} />);
  try {
    const beam = view.container.querySelector<HTMLElement>("[data-assistant-rail-beam]")!;
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
    const initialHeight = beam.getBoundingClientRect().height;

    // Simulate response continuing to stream, increasing its height
    await view.rerender(<Reply height={1200} />);
    // With increased height, percentage progress adjusts
    await expect.poll(() => beam.style.height).not.toBe(`${initialHeight}%`);
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
  } finally {
    await view.unmount();
  }
});
