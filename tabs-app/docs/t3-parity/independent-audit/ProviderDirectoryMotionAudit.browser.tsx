import "../../index.css";
import { CpuIcon } from "lucide-react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ProviderDirectory } from "./ProviderDirectory";
it("diagnoses hover rotation with explicit app reduced motion", async () => {
  const before = document.documentElement.getAttribute("data-reduced-motion");
  document.documentElement.setAttribute("data-reduced-motion", "reduce");
  const view = await render(
    <ProviderDirectory
      entries={[
        {
          id: "codex",
          name: "Codex",
          icon: CpuIcon,
          enabled: true,
          status: "Ready",
          statusClass: "",
          modelCount: 1,
        },
      ]}
      selectedId="codex"
      onSelect={() => {}}
    />,
  );
  try {
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
    const button = page.getByRole("button", { name: "Codex Ready 1" });
    await button.hover();
    const icon = button.element().querySelector<HTMLElement>(".provider-directory-icon")!;
    await expect.poll(() => getComputedStyle(icon).transform).not.toBe("none");
    expect(getComputedStyle(icon).transitionDuration).toBe("0s");
    console.log("AUDIT_REDUCED_MOTION", getComputedStyle(icon).transform);
  } finally {
    await view.unmount();
    if (before === null) document.documentElement.removeAttribute("data-reduced-motion");
    else document.documentElement.setAttribute("data-reduced-motion", before);
  }
});
