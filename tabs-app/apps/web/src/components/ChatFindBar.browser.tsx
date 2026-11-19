import "../index.css";
import { useRef } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ChatFindBar } from "./ChatFindBar";

function Harness({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: "relative", height: 200 }}>
      <ChatFindBar root={root} focusTick={0} onClose={onClose} />
      <div ref={root}>
        <p>Rename the sidebar.</p>
        <p>The Sidebar is wide. sidebar!</p>
      </div>
    </div>
  );
}

it("counts matches, steps through them, and closes with Escape", async () => {
  const onClose = vi.fn();
  const view = await render(<Harness onClose={onClose} />);
  try {
    await userEvent.type(page.getByLabelText("Find in conversation", { exact: true }), "sidebar");
    await expect.element(page.getByRole("status")).toHaveTextContent("1 of 3");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("status")).toHaveTextContent("2 of 3");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(page.getByRole("status")).toHaveTextContent("1 of 3");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("says when nothing matches", async () => {
  const view = await render(<Harness onClose={() => undefined} />);
  try {
    await userEvent.type(page.getByLabelText("Find in conversation", { exact: true }), "zzz");
    await expect.element(page.getByRole("status")).toHaveTextContent("No matches");
  } finally {
    await view.unmount();
  }
});
