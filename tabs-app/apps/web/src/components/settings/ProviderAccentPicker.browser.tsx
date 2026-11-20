import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ProviderAccentPicker } from "./ProviderAccentPicker";

it("picks a colour and clears it by picking the same one again", async () => {
  const onChange = vi.fn();
  const view = await render(
    <ProviderAccentPicker name="Work Codex" value="#4f7cff" onChange={onChange} />,
  );
  try {
    await expect
      .element(page.getByRole("button", { name: "Blue for Work Codex" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Green for Work Codex" }).click();
    expect(onChange).toHaveBeenLastCalledWith("#2f9e6e");
    await page.getByRole("button", { name: "Blue for Work Codex" }).click();
    expect(onChange).toHaveBeenLastCalledWith(null);
  } finally {
    await view.unmount();
  }
});
