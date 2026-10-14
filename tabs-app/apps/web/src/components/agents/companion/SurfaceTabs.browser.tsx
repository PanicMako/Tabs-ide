import "../../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { RightPanelTab } from "~/stores/rightPanelStore";
import { SurfaceChooser, SurfaceTabs } from "./SurfaceTabs";

it("opens, switches, closes and reopens surfaces with stable hover geometry", async () => {
  const onClosePanel = vi.fn();
  function Harness() {
    const [activeTab, setActiveTab] = useState<RightPanelTab>("diff");
    const [choosing, setChoosing] = useState(false);
    return (
      <div style={{ width: 560 }}>
        <SurfaceTabs
          activeTab={activeTab}
          choosing={choosing}
          onSelect={setActiveTab}
          onChooserChange={setChoosing}
          onClosePanel={onClosePanel}
          counts={{ stash: 3, queue: 2 }}
          dragRegion={false}
        />
        {choosing && (
          <SurfaceChooser
            onSelect={(tab) => {
              setActiveTab(tab);
              setChoosing(false);
            }}
          />
        )}
      </div>
    );
  }
  const view = await render(<Harness />);
  try {
    const add = page.getByRole("button", { name: "Open a surface", exact: true });
    await add.click();
    await page.getByRole("button", { name: "Stash Keep prompts for later" }).click();
    const stash = page.getByRole("tab", { name: "Stash 3" });
    await expect.element(stash).toHaveAttribute("aria-selected", "true");
    const before = stash.element().getBoundingClientRect();
    const addBounds = add.element().getBoundingClientRect();
    const tabListBounds = stash.element().closest('[role="tablist"]')!.getBoundingClientRect();
    expect(addBounds.left - tabListBounds.right).toBeLessThanOrEqual(8);
    await stash.hover();
    await new Promise((resolve) => setTimeout(resolve, 220));
    const after = stash.element().getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.top).toBe(before.top);
    expect(getComputedStyle(stash.element().parentElement!).transform).toBe("none");
    await stash.click();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(page.getByRole("tab", { name: "Diff" })).toHaveFocus();
    await userEvent.keyboard("{Delete}");
    await expect.element(stash).toHaveFocus();
    await page.getByRole("button", { name: "Close Stash surface" }).click();
    await expect.element(add).toHaveFocus();
    await page.getByRole("button", { name: "Stash Keep prompts for later" }).click();
    await expect.element(stash).toHaveAttribute("aria-selected", "true");
    await add.click();
    await page.getByRole("button", { name: "Queue Manage upcoming messages" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Queue 2" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Close side panel" }).click();
    expect(onClosePanel).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
  }
});

it("uses the theme font while preserving spring tilt and launcher shortcuts", async () => {
  const onSelect = vi.fn();
  const view = await render(
    <div
      style={{ width: 440, height: 680, "--font-sans": "Arial, sans-serif" } as React.CSSProperties}
    >
      <SurfaceChooser onSelect={onSelect} />
    </div>,
  );
  try {
    const browser = page.getByRole("button", { name: "Browser Explore and preview your work" });
    await browser.hover();
    await expect
      .poll(() => getComputedStyle(browser.element().querySelector(".surface-script")!).fontFamily)
      .toContain("Arial");
    await expect.poll(() => getComputedStyle(browser.element()).color).toBe("rgb(5, 5, 5)");
    expect(getComputedStyle(browser.element()).transform).not.toBe("none");
    await browser.click();
    expect(onSelect).toHaveBeenLastCalledWith("browser");
    await userEvent.keyboard("q");
    expect(onSelect).toHaveBeenLastCalledWith("queue");
  } finally {
    await view.unmount();
  }
});

it.each(["tabs-light", "tabs-dark", "dracula"])(
  "keeps tabs and close controls readable in %s",
  async (theme) => {
    function Harness() {
      const [activeTab, setActiveTab] = useState<RightPanelTab>("browser");
      const [choosing, setChoosing] = useState(false);
      return (
        <div
          data-theme={theme}
          className="companion-frame"
          style={{
            width: 520,
            height: 720,
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          <SurfaceTabs
            activeTab={activeTab}
            choosing={choosing}
            onSelect={setActiveTab}
            onChooserChange={setChoosing}
            onClosePanel={() => {}}
            counts={{}}
            dragRegion={false}
          />
          {choosing && (
            <SurfaceChooser
              onSelect={(tab) => {
                setActiveTab(tab);
                setChoosing(false);
              }}
            />
          )}
        </div>
      );
    }
    const view = await render(<Harness />);
    try {
      const add = page.getByRole("button", { name: "Open a surface", exact: true });
      await add.click();
      const chooser = document.querySelector<HTMLElement>(".surface-chooser")!;
      expect(getComputedStyle(chooser).backgroundColor).toBe(
        getComputedStyle(chooser.closest("[data-theme]")!).backgroundColor,
      );
      await page.getByRole("button", { name: "Files Navigate the project" }).click();
      await page.getByRole("tab", { name: "Browser", exact: true }).click();
      const files = page.getByRole("tab", { name: "Files", exact: true });
      const themeRoot = files.element().closest("[data-theme]")!;
      await expect
        .poll(() => getComputedStyle(files.element()).color)
        .toBe(getComputedStyle(themeRoot).color);
      await expect.element(files).toBeVisible();
      const close = page.getByRole("button", { name: "Close Browser surface" });
      await close.hover();
      await expect
        .poll(() => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(close.element()).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3]! / 255;
        })
        .toBeCloseTo(0.12, 1);
      expect(parseFloat(getComputedStyle(close.element()).borderRadius)).toBeGreaterThanOrEqual(
        close.element().getBoundingClientRect().width / 2,
      );
    } finally {
      await view.unmount();
    }
  },
);

it("expands and restores the panel without moving the add icon or losing tabs", async () => {
  function Harness() {
    const [activeTab, setActiveTab] = useState<RightPanelTab>("browser");
    const [choosing, setChoosing] = useState(false);
    const [maximized, setMaximized] = useState(false);
    return (
      <div style={{ width: 600 }}>
        <SurfaceTabs
          activeTab={activeTab}
          choosing={choosing}
          onSelect={setActiveTab}
          onChooserChange={setChoosing}
          onClosePanel={() => {}}
          counts={{}}
          dragRegion={false}
          maximized={maximized}
          onToggleMaximized={() => setMaximized((value) => !value)}
        />
        {choosing && (
          <SurfaceChooser
            onSelect={(tab) => {
              setActiveTab(tab);
              setChoosing(false);
            }}
          />
        )}
      </div>
    );
  }
  const view = await render(<Harness />);
  try {
    const add = page.getByRole("button", { name: "Open a surface", exact: true });
    await add.hover();
    expect(getComputedStyle(add.element().querySelector("svg")!).transform).toBe("none");
    await add.click();
    await page.getByRole("button", { name: "Files Navigate the project" }).click();
    await page.getByRole("button", { name: "Expand side panel" }).click();
    await expect
      .element(page.getByRole("button", { name: "Restore side panel" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("tab", { name: "Files", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Restore side panel" }).click();
    await expect.element(page.getByRole("tab", { name: "Browser", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Expand side panel" }))
      .toHaveAttribute("aria-pressed", "false");
  } finally {
    await view.unmount();
  }
});

it("selects and closes independent browser resources by ID", async () => {
  const select = vi.fn();
  const close = vi.fn();
  const view = await render(
    <SurfaceTabs
      activeTab="browser"
      activeInstanceId="second"
      instances={[
        { id: "first", kind: "browser", title: "First site" },
        { id: "second", kind: "browser", title: "Second site" },
        { id: "files", kind: "files" },
      ]}
      choosing={false}
      counts={{}}
      dragRegion={false}
      onSelect={vi.fn()}
      onChooserChange={vi.fn()}
      onClosePanel={vi.fn()}
      onSelectInstance={select}
      onCloseInstance={close}
    />,
  );
  try {
    await expect
      .element(page.getByRole("tab", { name: "Browser 2", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    expect(select).toHaveBeenCalledWith("first");
    await page.getByRole("button", { name: "Close Browser 2 surface", exact: true }).click();
    expect(close).toHaveBeenCalledWith("second");
  } finally {
    await view.unmount();
  }
});
