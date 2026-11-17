import "../../../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import type { SurfaceInstance } from "../SurfaceTabs";
import { CompanionDesignShell } from "./CompanionDesignShell";

function Harness({ onClosePanel }: { onClosePanel: () => void }) {
  const [instances, setInstances] = useState<SurfaceInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(true);
  const open = (kind: RightPanelTab) => {
    const existing = kind === "browser" ? null : instances.find((item) => item.kind === kind);
    const id = existing?.id ?? `${kind}-${instances.length + 1}`;
    if (!existing) setInstances((items) => [...items, { id, kind }]);
    setActiveId(id);
    setChoosing(false);
  };
  return (
    <div
      data-companion-design="grouped"
      className="companion-frame"
      style={{ width: 520, height: 640 }}
    >
      <CompanionDesignShell
        instances={instances}
        activeId={activeId}
        choosing={choosing}
        counts={{ stash: 2 }}
        dragRegion={false}
        maximized={false}
        projectName="tabs"
        onToggleMaximized={() => {}}
        onClosePanel={onClosePanel}
        onOpen={open}
        onFocusKind={open}
        onSelectInstance={(id) => {
          setActiveId(id);
          setChoosing(false);
        }}
        onCloseInstance={(id) => {
          const rest = instances.filter((item) => item.id !== id);
          setInstances(rest);
          setActiveId(rest[0]?.id ?? null);
          if (!rest.length) setChoosing(true);
        }}
        onChooserChange={setChoosing}
        body={<p>Body of {instances.find((item) => item.id === activeId)?.kind}</p>}
      />
    </div>
  );
}

it("opens a surface from its home, shows it, and closes the panel", async () => {
  const onClosePanel = vi.fn();
  const view = await render(<Harness onClosePanel={onClosePanel} />);
  try {
    await userEvent.keyboard("d");
    await expect.element(page.getByText("Body of diff")).toBeVisible();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect.element(page.getByText("Body of files")).toBeVisible();
    await page.getByRole("button", { name: "Close side panel" }).click();
    expect(onClosePanel).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("keeps several browser pages as tabs under the switcher", async () => {
  const view = await render(<Harness onClosePanel={() => {}} />);
  try {
    await userEvent.keyboard("b");
    await page.getByRole("button", { name: "New browser tab" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Browser 2" }))
      .toHaveAttribute("aria-selected", "true");
    const pages = page.getByRole("tablist", { name: "Browser tabs" });
    await pages.getByRole("tab", { name: "Browser", exact: true }).click();
    await expect
      .element(pages.getByRole("tab", { name: "Browser", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Close Browser 2" }).click();
    await expect.element(page.getByRole("tab", { name: "Browser 2" })).not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});
