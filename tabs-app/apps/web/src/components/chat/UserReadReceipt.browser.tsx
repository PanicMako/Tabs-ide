import "../../index.css";
import "./user-message.css";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { UserReadReceipt } from "./UserReadReceipt";

it("stays hidden when no wallpaper is on, so regular chat is unchanged", async () => {
  const view = await render(<UserReadReceipt seen />);
  try {
    const receipt = view.container.querySelector<HTMLElement>(".user-message-receipt")!;
    expect(getComputedStyle(receipt).display).toBe("none");
    expect(receipt.getAttribute("aria-label")).toBe("Seen by the agent");
  } finally {
    await view.unmount();
  }
});
