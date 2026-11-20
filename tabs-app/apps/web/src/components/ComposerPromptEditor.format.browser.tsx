import "../index.css";
import { useState } from "react";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ComposerPromptEditor } from "./ComposerPromptEditor";

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  return (
    <ComposerPromptEditor
      value={value}
      cursor={cursor}
      terminalContexts={[]}
      disabled={false}
      placeholder="Ask anything"
      onRemoveTerminalContext={() => {}}
      onPaste={() => {}}
      onChange={(next, nextCursor) => {
        setValue(next);
        setCursor(nextCursor);
        onValue(next);
      }}
    />
  );
}

const mod = navigator.platform.includes("Mac") ? "Meta" : "Control";

it("wraps a selection in bold and unwraps it again with the keyboard", async () => {
  let latest = "";
  const view = await render(<Harness onValue={(value) => (latest = value)} />);
  try {
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    editor.focus();
    await userEvent.keyboard("hello");
    await userEvent.keyboard(
      "{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}",
    );
    await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
    await expect.poll(() => latest).toBe("**hello**");
    await userEvent.keyboard("{ArrowLeft}");
  } finally {
    await view.unmount();
  }
});

it("puts the caret between the markers when nothing is selected", async () => {
  let latest = "";
  const view = await render(<Harness onValue={(value) => (latest = value)} />);
  try {
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    editor.focus();
    await userEvent.keyboard(`{${mod}>}e{/${mod}}`);
    await userEvent.keyboard("code");
    await expect.poll(() => latest).toBe("`code`");
  } finally {
    await view.unmount();
  }
});
