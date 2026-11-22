import "../../index.css";

import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TemplateCarousel } from "./TemplateCarousel";
import { TEAMMATE_TEMPLATES } from "./teammateTemplates";

describe("TemplateCarousel", () => {
  it("marks the chosen card and steps with the arrows", async () => {
    const onSelect = vi.fn();
    await render(
      <TemplateCarousel
        templates={TEAMMATE_TEMPLATES}
        selectedId={TEAMMATE_TEMPLATES[0]!.id}
        onSelect={onSelect}
      />,
    );
    await expect
      .element(page.getByRole("radio", { name: /Generalist/ }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("button", { name: "Previous starting point" }))
      .toBeDisabled();
    await page.getByRole("button", { name: "Next starting point" }).click();
    expect(onSelect).toHaveBeenCalledWith(TEAMMATE_TEMPLATES[1]!.id);
  });

  it("picks a card on click and steps with the keyboard", async () => {
    const onSelect = vi.fn();
    await render(
      <TemplateCarousel
        templates={TEAMMATE_TEMPLATES}
        selectedId={TEAMMATE_TEMPLATES[2]!.id}
        onSelect={onSelect}
      />,
    );
    await page.getByRole("radio", { name: /Release captain/ }).click();
    expect(onSelect).toHaveBeenCalledWith("release-captain");
    (document.querySelector("[role=radio][aria-checked=true]") as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith(TEAMMATE_TEMPLATES[3]!.id);
  });
});
