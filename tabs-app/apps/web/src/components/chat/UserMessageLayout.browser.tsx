import "../../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { UserMessageLayout, UserPromptText } from "./UserMessageLayout";

const source =
  "\r\n\r\nHi!\n\n\nPlease improve the readability of a long prompt while preserving the quiet line at the right. All lines should read naturally from left to right.\n\n    const keepIndentation = true;\n        keepThisLineIndented();\n\n";
function Message({ text }: { text: string }) {
  return (
    <UserMessageLayout
      actions={
        <>
          <button type="button">Copy message</button>
          <time>03:59:47 AM</time>
        </>
      }
    >
      <UserPromptText text={text} />
    </UserMessageLayout>
  );
}

it("keeps short text close to its right rail without borrowing the timestamp width", async () => {
  const view = await render(<Message text="Hi" />);
  try {
    const frame = view.container.querySelector<HTMLElement>(".user-message-frame")!;
    const meta = view.container.querySelector<HTMLElement>(".user-message-actions")!;
    expect(frame.getBoundingClientRect().width).toBeLessThan(meta.getBoundingClientRect().width);
    expect(frame.getBoundingClientRect().width).toBeLessThan(80);
    expect(
      Math.abs(meta.getBoundingClientRect().right - frame.getBoundingClientRect().right),
    ).toBeLessThan(1);
    const rail = view.container.querySelector<HTMLElement>(".user-message-content")!;
    expect(getComputedStyle(rail).borderRightWidth).toBe("2px");
  } finally {
    await view.unmount();
  }
});

it("uses compact paragraphs, preserves intentional indentation, and wraps long prompts on desktop and phone", async () => {
  const view = await render(
    <div style={{ padding: 16 }}>
      <Message text={source} />
      <Message text={"workspace/" + "long-path-segment".repeat(60)} />
    </div>,
  );
  try {
    const paragraphs = view.container
      .querySelectorAll(".user-prompt-prose")[0]!
      .querySelectorAll("p");
    expect(paragraphs.length).toBe(3);
    expect(paragraphs[0]!.textContent).toBe("Hi!");
    expect(paragraphs[2]!.textContent).toBe(
      "    const keepIndentation = true;\n        keepThisLineIndented();",
    );
    expect(getComputedStyle(paragraphs[1]!).marginTop).toBe("12px");
    expect(getComputedStyle(paragraphs[1]!).textAlign).toBe("start");
    for (const width of [1280, 390]) {
      await page.viewport(width, 1000);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const frame = view.container.querySelector<HTMLElement>(".user-message-frame")!;
      expect(frame.getBoundingClientRect().width).toBeLessThanOrEqual(700);
      await page.screenshot({
        element: view.container,
        path: `__screenshots__/user-messages/${width}.png`,
      });
    }
  } finally {
    await view.unmount();
  }
});

it("keeps short text close to its line below a wider attachment", async () => {
  const view = await render(
    <UserMessageLayout
      actions={<time>4:48 AM</time>}
      attachments={<div style={{ width: 280, height: 120 }}>Attachment</div>}
    >
      <UserPromptText text="Analyse this image" />
    </UserMessageLayout>,
  );
  try {
    const frame = view.container.querySelector<HTMLElement>(".user-message-frame")!;
    const content = view.container.querySelector<HTMLElement>(".user-message-content")!;
    expect(content.getBoundingClientRect().width).toBeLessThan(frame.getBoundingClientRect().width);
    const range = document.createRange();
    range.selectNodeContents(content.querySelector("p")!);
    expect(
      content.getBoundingClientRect().right - range.getBoundingClientRect().right,
    ).toBeLessThan(22);
  } finally {
    await view.unmount();
  }
});

function ScrollablePrompt() {
  const [scroll, setScroll] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScroll} data-scroll style={{ height: 300, overflow: "auto" }}>
      <div style={{ height: 250 }} />
      <UserMessageLayout actions={<time>Now</time>} scrollContainer={scroll}>
        <div style={{ height: 400 }}>A long prompt.</div>
      </UserMessageLayout>
      <div style={{ height: 400 }} />
    </div>
  );
}
it("keeps the rail lit at the viewport edge and fades it only after the prompt leaves", async () => {
  const view = await render(<ScrollablePrompt />);
  try {
    const scroll = view.container.querySelector<HTMLElement>("[data-scroll]")!;
    const content = view.container.querySelector<HTMLElement>(".user-message-content")!;
    const beam = view.container.querySelector<HTMLElement>(".user-message-rail-beam")!;
    await expect.poll(() => content.dataset.railActive).toBe("true");
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("1");
    expect(beam.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(beam.getBoundingClientRect().height).toBeLessThan(30);
    scroll.scrollTop = 500;
    await expect
      .poll(() => Math.abs(beam.getBoundingClientRect().top - scroll.getBoundingClientRect().top))
      .toBeLessThan(1);
    expect(content.dataset.railActive).toBe("true");
    scroll.scrollTop = 750;
    await expect.poll(() => getComputedStyle(beam).opacity).toBe("0");
    expect(content.dataset.railActive).toBe("false");
  } finally {
    await view.unmount();
  }
});
