import "../../index.css";
import "../../interface-study.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import workbenchStyles from "../../../../../../tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css?raw";
import embeddedWorkbenchStyles from "../../../../../../tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/embeddedWorkbench.css?raw";
import { previewTheme, restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { Button } from "./button";
import { Input } from "./input";

it("keeps controls, highlights and content surfaces consistent across theme skins", async () => {
  const originalStudy = document.documentElement.getAttribute("data-interface-study");
  const view = await render(
    <div>
      <Button className="rounded-md" data-testid="control">
        Action
      </Button>
      <input aria-label="Search" className="rounded-sm" data-testid="control" />
      <div role="option" aria-selected="true" className="rounded-none" data-testid="control">
        Selected result
      </div>
      <mark data-testid="pill">Search match</mark>
      <div data-slot="card" className="rounded-xl" data-testid="surface">
        Card
      </div>
      <div data-slot="dialog-popup" className="rounded-none" data-testid="surface">
        Dialog
      </div>
      <textarea aria-label="Message" data-testid="surface" />
      <div className="rounded-md" data-testid="surface">
        Custom highlight
      </div>
    </div>,
  );
  try {
    for (const skin of [null, "light", "dark"]) {
      if (skin) document.documentElement.setAttribute("data-interface-study", skin);
      else document.documentElement.removeAttribute("data-interface-study");
      for (const control of document.querySelectorAll('[data-testid="control"]')) {
        expect(getComputedStyle(control).borderRadius).toBe("36px");
      }
      expect(getComputedStyle(view.container.querySelector("mark")!).borderRadius).toBe("36px");
      for (const surface of document.querySelectorAll('[data-testid="surface"]')) {
        expect(getComputedStyle(surface).borderRadius).toBe("36px");
      }
    }
    const button = view.container.querySelector("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(button).boxShadow).not.toBe("none");
  } finally {
    if (originalStudy === null) document.documentElement.removeAttribute("data-interface-study");
    else document.documentElement.setAttribute("data-interface-study", originalStudy);
    await view.unmount();
  }
});

it("uses proportionate Code OSS rows, text highlights and continuous notification frames", async () => {
  const style = document.createElement("style");
  style.textContent = workbenchStyles;
  document.head.append(style);
  const view = await render(
    <div className="monaco-workbench">
      <div className="monaco-list">
        <div className="monaco-list-row selected" data-testid="tree-row">
          SECURITY.md
        </div>
      </div>
      <div className="monaco-editor">
        <div className="view-overlays">
          <div className="current-line" data-testid="line" />
        </div>
        <div className="findMatch" data-testid="match" />
        <div className="selected-text top-left-radius bottom-left-radius" data-testid="selection" />
      </div>
      <div className="notifications-center">
        <div className="notifications-list-container monaco-list">
          <div className="monaco-list-row focused" data-testid="notification-focus">
            Focused notification
          </div>
          <div className="monaco-list-row" data-testid="notification">
            A multiline notification
          </div>
        </div>
      </div>
      <div className="notifications-toasts">
        <div className="notification-toast">
          <div className="monaco-list">
            <div className="monaco-list-row" data-testid="toast">
              Standalone toast
            </div>
          </div>
        </div>
      </div>
      <div className="monaco-button-dropdown">
        <div className="monaco-button monaco-text-button" data-testid="split-start">
          Run
        </div>
        <div className="monaco-button monaco-dropdown-button" data-testid="split-end">
          More
        </div>
      </div>
    </div>,
  );
  const element = (id: string) => view.container.querySelector(`[data-testid="${id}"]`)!;
  try {
    expect(getComputedStyle(element("tree-row")).borderRadius).toBe("36px");
    for (const id of ["line", "match"]) {
      expect(getComputedStyle(element(id)).borderRadius).toBe("5px");
    }
    expect(getComputedStyle(element("notification")).borderRadius).toBe("0px 0px 36px 36px");
    expect(
      getComputedStyle(view.container.querySelector(".notifications-center")!).borderRadius,
    ).toBe("36px");
    expect(getComputedStyle(element("notification-focus")).borderRadius).toBe("36px");
    expect(getComputedStyle(element("toast")).borderRadius).toBe("36px");
    const selection = getComputedStyle(element("selection"));
    expect(selection.borderTopLeftRadius).toBe("5px");
    expect(selection.borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(element("split-start")).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(element("split-end")).borderTopLeftRadius).toBe("0px");
  } finally {
    style.remove();
    await view.unmount();
  }
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "keeps Code pickers and inputs rounded (embedded: %s, reversed styles: %s)",
  async (embedded, reversedStyles) => {
    const originalEmbedded = document.documentElement.classList.contains("tabs-embedded-workbench");
    document.documentElement.classList.toggle("tabs-embedded-workbench", embedded);
    const style = document.createElement("style");
    // Embedded layout must not introduce a second owner for corner geometry.
    expect(embeddedWorkbenchStyles).not.toMatch(/[\w-]*radius[\w-]*\s*:/i);
    style.textContent = (
      reversedStyles
        ? [embeddedWorkbenchStyles, workbenchStyles]
        : [workbenchStyles, embeddedWorkbenchStyles]
    ).join("\n");
    document.head.append(style);
    const view = await render(
      <div
        className="monaco-workbench"
        style={{ padding: 24, background: "var(--background)", color: "var(--foreground)" }}
      >
        <div
          className="quick-input-widget"
          style={{
            position: "relative",
            width: "min(580px, 100%)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            padding: 12,
          }}
        >
          <div className="quick-input-header">
            <div
              className="monaco-inputbox"
              style={{ border: "1px solid var(--border)", height: 32 }}
            >
              <input
                className="input"
                aria-label="Search files"
                defaultValue="README"
                style={{ width: "100%", height: "100%", background: "transparent" }}
              />
            </div>
          </div>
          <div className="monaco-list" style={{ marginTop: 8 }}>
            <div
              className="monaco-list-row focused"
              style={{ padding: "6px 14px", background: "var(--accent)" }}
            >
              README.md
            </div>
          </div>
        </div>
        <div className="search-view">
          <div className="monaco-inputbox" data-testid="search-field" />
        </div>
        <div className="settings-editor">
          <div className="monaco-inputbox" data-testid="settings-field" />
        </div>
        <div className="monaco-button" data-testid="code-button" />
      </div>,
    );
    try {
      for (const selector of [
        ".quick-input-widget",
        ".quick-input-widget .monaco-inputbox",
        ".monaco-list-row",
        '[data-testid="search-field"]',
        '[data-testid="settings-field"]',
        '[data-testid="code-button"]',
      ]) {
        expect(getComputedStyle(view.container.querySelector(selector)!).borderTopLeftRadius).toBe(
          "36px",
        );
      }
      const input = view.container.querySelector<HTMLInputElement>("input")!;
      input.focus();
      input.setSelectionRange(0, 6);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(6);
      expect(getComputedStyle(input).paddingLeft).toBe("12px");
      expect(
        getComputedStyle(view.container.querySelector(".quick-input-header")!).paddingLeft,
      ).toBe("12px");
      await page.screenshot({
        element: view.container,
        path: "__screenshots__/radii/code-picker.png",
      });
    } finally {
      style.remove();
      document.documentElement.classList.toggle("tabs-embedded-workbench", originalEmbedded);
      await view.unmount();
    }
  },
);

it("preserves authentic project tabs with rounded top corners and flush bottom connection for fillets", async () => {
  const study = document.documentElement.getAttribute("data-interface-study");
  const view = await render(
    <div data-slot="workspace-tabbar" className="border-b bg-background p-3 pb-0">
      <div className="flex items-end gap-3">
        <div
          data-slot="workspace-project-tab"
          data-active="true"
          className="relative -mb-px rounded-t-xl border border-b-0 bg-card px-8 py-3"
        >
          tabs
          <svg className="tab-bottom-fillet absolute bottom-0 -right-3 h-3 w-3" viewBox="0 0 12 10">
            <path d="M 0 0 L 2 0 A 10 10 0 0 0 12 10 L 0 10 Z" fill="currentColor" />
          </svg>
        </div>
        <div
          data-slot="workspace-project-tab"
          className="rounded-t-xl border border-transparent px-8 py-3"
        >
          Passes
        </div>
        <div
          data-slot="workspace-project-tab"
          className="rounded-t-xl border border-transparent px-8 py-3"
        >
          New Tab
        </div>
      </div>
    </div>,
  );
  try {
    for (const skin of [null, "light", "dark"]) {
      if (skin) document.documentElement.setAttribute("data-interface-study", skin);
      else document.documentElement.removeAttribute("data-interface-study");
      for (const tab of view.container.querySelectorAll('[data-slot="workspace-project-tab"]')) {
        const shape = getComputedStyle(tab);
        expect(shape.borderTopLeftRadius).toBe("16px");
        expect(shape.borderBottomLeftRadius).toBe("0px");
        expect(shape.borderBottomRightRadius).toBe("0px");
      }
      expect(getComputedStyle(view.container.querySelector("svg")!).display).not.toBe("none");
    }
    document.documentElement.removeAttribute("data-interface-study");
    const active = view.container.querySelector('[data-active="true"]')!;
    expect(getComputedStyle(active).borderBottomWidth).toBe("0px");
    expect(getComputedStyle(active).marginBottom).toBe("-1px");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/project-tab-shape.png",
    });
  } finally {
    if (study === null) document.documentElement.removeAttribute("data-interface-study");
    else document.documentElement.setAttribute("data-interface-study", study);
    await view.unmount();
  }
});

it.each(["true-black", "solarized-light"] as const)(
  "joins the New Tab strip to the Welcome canvas in %s",
  async (theme) => {
    const snapshot = snapshotThemeState();
    previewTheme(theme);
    const view = await render(
      <>
        <div
          data-slot="workspace-tabbar"
          data-surface="welcome"
          className="w-96 border-b px-3 pt-2"
        >
          <div className="flex items-end gap-2.5 overflow-x-auto">
            <div className="border border-transparent px-4 py-2">Passes</div>
            <div
              data-slot="workspace-project-tab"
              data-active="true"
              className="relative -mb-px rounded-t-xl border bg-card px-4 py-2"
            >
              New Tab
              {["-left-2.5 -scale-x-100", "-right-2.5"].map((side) => (
                <svg
                  key={side}
                  className={`tab-bottom-fillet absolute -bottom-px ${side}`}
                  width="12"
                  height="10"
                  viewBox="0 0 12 10"
                >
                  <path className="tab-bottom-fillet-fill" d="M0 0 H2 A10 10 0 0 0 12 10 H0 Z" />
                  <path
                    className="tab-bottom-fillet-stroke"
                    fill="none"
                    d="M2 0 A10 10 0 0 0 12 10"
                  />
                </svg>
              ))}
            </div>
          </div>
        </div>
        <div data-slot="workspace-welcome" className="bg-background">
          Welcome
        </div>
      </>,
    );
    try {
      const bar = view.container.querySelector('[data-slot="workspace-tabbar"]')!;
      const tab = bar.querySelector('[data-active="true"]')!;
      const welcome = view.container.querySelector('[data-slot="workspace-welcome"]')!;
      const canvas = getComputedStyle(welcome).backgroundColor;
      expect(getComputedStyle(bar).backgroundColor).toBe(canvas);
      expect(getComputedStyle(tab).backgroundColor).toBe(canvas);
      expect(getComputedStyle(bar.querySelector(".tab-bottom-fillet-fill")!).fill).toBe(canvas);
      expect(getComputedStyle(bar.querySelector(".tab-bottom-fillet-stroke")!).stroke).toBe(
        getComputedStyle(tab).borderTopColor,
      );
      expect(getComputedStyle(bar).borderBottomWidth).toBe("0px");
      expect(getComputedStyle(tab).borderBottomWidth).toBe("0px");

      const { base64 } = await page.screenshot({
        element: bar,
        base64: true,
        path: `__screenshots__/welcome-tab-strip-${theme}.png`,
      });
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const screenshot = document.createElement("canvas");
      screenshot.width = image.width;
      screenshot.height = image.height;
      const context = screenshot.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      const bounds = bar.getBoundingClientRect();
      const selected = tab.getBoundingClientRect();
      const tabCenter = Math.round(
        ((selected.left + selected.width / 2 - bounds.left) / bounds.width) * image.width,
      );
      const background = pixel(4, 4);
      const bottom = image.height - 1;
      const divider = pixel(4, bottom);
      const difference = (a: number[], b: number[]) =>
        Math.max(...a.map((channel, index) => Math.abs(channel - b[index]!)));
      expect(difference(divider, background)).toBeGreaterThan(4);
      expect(difference(pixel(image.width - 5, bottom), divider)).toBeLessThanOrEqual(2);
      expect(difference(pixel(tabCenter, bottom), background)).toBeLessThanOrEqual(2);
    } finally {
      await view.unmount();
      restoreThemeSnapshot(snapshot);
    }
  },
);

it("centers text vertically and maintains pill radius in inputs across sizes and flex containers", async () => {
  const view = await render(
    <div className="flex flex-col gap-4 p-4">
      <Input data-testid="default-input" defaultValue="npm install" />
      <Input size="sm" data-testid="sm-input" defaultValue="npm test" />
      <Input size="lg" data-testid="lg-input" defaultValue="npm build" />
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full">1</div>
        <Input data-testid="row-input" defaultValue="npm run dev" />
      </div>
    </div>,
  );
  try {
    for (const testId of ["default-input", "sm-input", "lg-input", "row-input"]) {
      const input = view.container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
      expect(input).not.toBeNull();
      const control = input.closest('[data-slot="input-control"]') as HTMLElement;
      expect(control).not.toBeNull();

      const controlStyle = getComputedStyle(control);
      const inputStyle = getComputedStyle(input);

      // Control wrapper uses items-center for vertical alignment
      expect(controlStyle.alignItems).toBe("center");

      // Inner input is centered vertically within the control
      const controlRect = control.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const controlCenter = controlRect.top + controlRect.height / 2;
      const inputCenter = inputRect.top + inputRect.height / 2;
      expect(Math.abs(inputCenter - controlCenter)).toBeLessThan(0.1);

      expect(inputStyle.paddingTop).toBe("0px");
      expect(inputStyle.paddingBottom).toBe("0px");

      // Both control and inner input maintain pill curvature (clamped by height)
      expect(controlStyle.borderTopLeftRadius).toBe("36px");
      expect(controlStyle.borderBottomRightRadius).toBe("36px");
      expect(inputStyle.borderTopLeftRadius).toBe("36px");
      expect(inputStyle.borderBottomRightRadius).toBe("36px");
    }
  } finally {
    await view.unmount();
  }
});
