import "../index.css";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import ChatMarkdown from "./ChatMarkdown";

it("draws $$ formulas, inline and as a block", async () => {
  const view = await render(
    <ChatMarkdown text={"Energy is $$E = mc^2$$ here.\n\n$$\n\\frac{a}{b}\n$$"} cwd={undefined} />,
  );
  try {
    await expect
      .poll(() => view.container.querySelectorAll(".katex").length)
      .toBeGreaterThanOrEqual(2);
    expect(view.container.querySelector(".katex-display")).not.toBeNull();
  } finally {
    await view.unmount();
  }
});

it("leaves single dollar signs, such as prices and shell variables, as plain text", async () => {
  const view = await render(
    <ChatMarkdown text={"It costs $5 and $10, and $HOME is set."} cwd={undefined} />,
  );
  try {
    expect(view.container.querySelector(".katex")).toBeNull();
    expect(view.container.textContent).toContain("It costs $5 and $10, and $HOME is set.");
  } finally {
    await view.unmount();
  }
});

it("shows a broken formula as text instead of failing the message", async () => {
  const view = await render(
    <ChatMarkdown text={"Oops $$\\notacommand{x$$ done"} cwd={undefined} />,
  );
  try {
    expect(view.container.textContent).toContain("done");
  } finally {
    await view.unmount();
  }
});

it("draws a finished mermaid block as a diagram, and keeps a streaming one as code", async () => {
  const text = "```mermaid\ngraph TD\n  A[Plan] --> B[Ship]\n```";
  const finished = await render(<ChatMarkdown text={text} cwd={undefined} />);
  try {
    await expect
      .poll(() => finished.container.querySelector('[aria-label="Mermaid diagram"] svg'))
      .not.toBeNull();
    expect(finished.container.textContent).toContain("Plan");
  } finally {
    await finished.unmount();
  }
  const streaming = await render(<ChatMarkdown text={text} cwd={undefined} isStreaming />);
  try {
    expect(streaming.container.querySelector('[aria-label="Mermaid diagram"]')).toBeNull();
  } finally {
    await streaming.unmount();
  }
});

it("falls back to the source when a mermaid block cannot be drawn", async () => {
  const view = await render(
    <ChatMarkdown text={"```mermaid\nthis is not a diagram\n```"} cwd={undefined} />,
  );
  try {
    await expect.poll(() => view.container.textContent ?? "").toContain("this is not a diagram");
    expect(view.container.querySelector('[aria-label="Mermaid diagram"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});
