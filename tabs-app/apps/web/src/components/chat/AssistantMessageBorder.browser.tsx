import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { AssistantMessageBorder } from "./AssistantMessageBorder";

function Reply({ height }: { height: number }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} data-scroll style={{ height: 300, overflow: "auto" }}>
      <AssistantMessageBorder scrollContainer={container}>
        <div style={{ height }}>A response that continues as the model streams.</div>
      </AssistantMessageBorder>
    </div>
  );
}

it("lights the visible portion of a long reply and follows scrolling", async () => {
  const view = await render(<Reply height={10000} />);
  try {
    const scroll = view.container.querySelector<HTMLElement>("[data-scroll]")!;
    const rail = view.container.querySelector<HTMLElement>("[data-assistant-rail]")!;
    const beam = view.container.querySelector<HTMLElement>("[data-assistant-rail-beam]")!;
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
    await expect.poll(() => beam.getBoundingClientRect().height).toBeCloseTo(96, 0);
    const before = beam.getBoundingClientRect().top - rail.getBoundingClientRect().top;
    scroll.scrollTop = 4000;
    await expect
      .poll(() => beam.getBoundingClientRect().top - scroll.getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(0);
    expect(beam.getBoundingClientRect().top - rail.getBoundingClientRect().top).toBeGreaterThan(
      before,
    );
    expect(rail.dataset.railActive).toBe("true");
  } finally {
    await view.unmount();
  }
});

it("remeasures when streaming changes the reply height without a scroll event", async () => {
  const view = await render(<Reply height={80} />);
  try {
    const beam = view.container.querySelector<HTMLElement>("[data-assistant-rail-beam]")!;
    await expect.poll(() => beam.getBoundingClientRect().height).toBeCloseTo(80, 0);
    await view.rerender(<Reply height={5000} />);
    await expect.poll(() => beam.getBoundingClientRect().height).toBeCloseTo(96, 0);
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
  } finally {
    await view.unmount();
  }
});
