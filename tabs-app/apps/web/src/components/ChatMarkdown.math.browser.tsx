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
