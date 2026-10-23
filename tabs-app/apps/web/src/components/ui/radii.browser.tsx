import "../../index.css";
import "../../interface-study.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import workbenchStyles from "../../../../../../tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css?raw";
import { Button } from "./button";

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
    expect(getComputedStyle(element("tree-row")).borderRadius).toBe("10px");
    for (const id of ["line", "match"]) {
      expect(getComputedStyle(element(id)).borderRadius).toBe("6px");
    }
    expect(getComputedStyle(element("notification")).borderRadius).toBe("0px 0px 24px 24px");
    expect(
      getComputedStyle(view.container.querySelector(".notifications-center")!).borderRadius,
    ).toBe("24px");
    expect(getComputedStyle(element("notification-focus")).borderRadius).toBe("10px");
    expect(getComputedStyle(element("toast")).borderRadius).toBe("24px");
    const selection = getComputedStyle(element("selection"));
    expect(selection.borderTopLeftRadius).toBe("6px");
    expect(selection.borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(element("split-start")).borderTopRightRadius).toBe("0px");
    expect(getComputedStyle(element("split-end")).borderTopLeftRadius).toBe("0px");
  } finally {
    style.remove();
    await view.unmount();
  }
});

it("preserves browser-style project tabs with joined bottoms and visible fillets", async () => {
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
