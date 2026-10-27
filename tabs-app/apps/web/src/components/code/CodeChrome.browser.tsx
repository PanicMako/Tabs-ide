import "../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  CODE_CHROME_COMMANDS,
  DEFAULT_CODE_CHROME_STATE,
  type CodeRailPresentation,
} from "@tabs/shared/codeChrome";
import { isMacPlatform } from "../../lib/utils";
import { CodeHeaderBar } from "./CodeHeaderBar";
import { CodeActivityRail } from "./CodeActivityRail";
import { restoreThemeSnapshot, snapshotThemeState } from "../../hooks/useTheme";
import { THEME_DEFINITIONS, type CustomThemeConfig } from "../../lib/themes";
import { evaluateThemeTokens } from "@tabs/shared/themeDerivation";

it("keeps Code actions accessible after compacting the chrome", async () => {
  await page.viewport(1280, 800);
  const runCommand = vi.fn();
  const toggleChat = vi.fn();
  const menuOpenChange = vi.fn(async () => {});
  const view = await render(
    <div className="code-workspace h-96 bg-background">
      <CodeHeaderBar
        workspaceName="Tabs"
        activeFilePath="/workspace/tabs/SECURITY.md"
        branch="main"
        panelOpen
        panelMaximized={false}
        sideChatOpen={false}
        sideChatLabel="Toggle Tabs AI chat"
        onToggleSideChat={toggleChat}
        onRunCommand={runCommand}
        onMenuOpenChange={menuOpenChange}
      />
      <CodeActivityRail chromeState={DEFAULT_CODE_CHROME_STATE} onRunCommand={runCommand} />
    </div>,
  );

  const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
  await page.getByRole("button", { name: "Toggle panel" }).element().focus();
  await userEvent.keyboard(`{${modifier}>}p{/${modifier}}`);
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.quickOpen);
  await userEvent.keyboard(`{${modifier}>}{Shift>}p{/Shift}{/${modifier}}`);
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.commandPalette);
  await page.getByRole("button", { name: "Quick open file search" }).click();
  await expect
    .element(page.getByRole("group", { name: "Current file" }))
    .toHaveTextContent("Tabs/SECURITY.md");
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.quickOpen);
  await expect
    .element(page.getByRole("button", { name: "Toggle panel" }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Toggle Tabs AI chat" }).click();
  expect(toggleChat).toHaveBeenCalledOnce();
  const menuBounds = page
    .getByRole("button", { name: "Code application menu" })
    .element()
    .getBoundingClientRect();
  const explorerBounds = page
    .getByRole("button", { name: "Explorer", exact: true })
    .element()
    .getBoundingClientRect();
  expect(menuBounds.bottom).toBeLessThanOrEqual(explorerBounds.top);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(runCommand).toHaveBeenLastCalledWith("workbench.view.search");

  await page.getByRole("button", { name: "More Code actions" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Run Task", exact: true })).toBeVisible();
  expect(menuOpenChange).toHaveBeenLastCalledWith(true);
  await page.getByRole("menuitem", { name: "Run Task", exact: true }).click();
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.runTask);
  expect(menuOpenChange).toHaveBeenLastCalledWith(false);

  await page.getByRole("button", { name: "More Code actions" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Editor Settings" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("button", { name: "More Code actions" })).toHaveFocus();
  expect(menuOpenChange).toHaveBeenLastCalledWith(false);
  await view.unmount();
});

it("waits for the native editor to suspend before showing the overflow menu", async () => {
  let finishSuspending!: () => void;
  const suspended = new Promise<void>((resolve) => {
    finishSuspending = resolve;
  });
  const view = await render(
    <div className="code-workspace">
      <CodeHeaderBar
        workspaceName="Tabs"
        activeFilePath={null}
        branch={null}
        panelOpen={false}
        panelMaximized={false}
        sideChatOpen={false}
        sideChatLabel="Toggle Tabs AI chat"
        onToggleSideChat={() => {}}
        onRunCommand={() => {}}
        onMenuOpenChange={(open) => (open ? suspended : Promise.resolve())}
      />
    </div>,
  );
  await page.getByRole("button", { name: "More Code actions" }).click();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  finishSuspending();
  await expect.element(page.getByRole("menuitem", { name: "Command Palette" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await view.unmount();
});

it.each([
  { width: 600, sideChatWidth: 0 },
  { width: 1280, sideChatWidth: 0 },
  { width: 1440, sideChatWidth: 0 },
  { width: 1920, sideChatWidth: 0 },
  { width: 1280, sideChatWidth: 320 },
])(
  "aligns file search with the native picker at $width px with $sideChatWidth px chat",
  async ({ width, sideChatWidth }) => {
    await page.viewport(width, 900);
    const view = await render(
      <div
        className="code-workspace w-full"
        style={{ "--code-sidechat-width": `${sideChatWidth}px` } as React.CSSProperties}
      >
        <CodeHeaderBar
          workspaceName="A project with a long name that must truncate"
          activeFilePath="/workspace/another-long-directory/A-very-long-current-file-name.tsx"
          branch={null}
          panelOpen={false}
          panelMaximized={false}
          sideChatOpen={false}
          sideChatLabel="Toggle Tabs AI chat"
          onToggleSideChat={() => {}}
          onRunCommand={() => {}}
          onMenuOpenChange={async () => {}}
        />
      </div>,
    );
    const search = document.querySelector(".code-quick-open")!.getBoundingClientRect();
    const actions = document.querySelector(".code-command-actions")!.getBoundingClientRect();
    expect(search.right).toBeLessThanOrEqual(actions.left);
    expect(search.width).toBeGreaterThan(100);
    // Native WebContentsView excludes the 60px rail + 4px gutter and Tabs chat.
    const nativePickerCenter = 64 + (width - 64 - sideChatWidth) / 2;
    expect(Math.abs((search.left + search.right) / 2 - nativePickerCenter)).toBeLessThan(1);
    const actionButton = page.getByRole("button", { name: "Toggle panel" }).element();
    expect(actionButton.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
    if (width >= 700) {
      const location = document.querySelector(".code-current-file")!.getBoundingClientRect();
      expect(location.right).toBeLessThanOrEqual(search.left);
    }
    expect(actions.right).toBeLessThanOrEqual(width);
    await view.unmount();
  },
);

it.each(["tabs-light", "tabs-dark"] as const)(
  "shares the %s surface palette across the rail and native Explorer",
  (theme) => {
    const snapshot = snapshotThemeState();
    const setTheme = vi.fn(async (_payload: unknown) => {});
    vi.stubGlobal("desktopBridge", { setTheme });
    try {
      restoreThemeSnapshot({ ...snapshot, theme });
      const payload = setTheme.mock.calls.at(-1)![0] as { customConfig: CustomThemeConfig };
      expect(payload.customConfig.colors.card).toBe(THEME_DEFINITIONS[theme].colors.card);
      const nativeTokens = evaluateThemeTokens(payload.customConfig);
      expect(nativeTokens["sideBar.background"]).toBe(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--vscode-sideBar-background")
          .trim(),
      );
    } finally {
      restoreThemeSnapshot(snapshot);
      vi.unstubAllGlobals();
    }
  },
);

it("keeps selected tool text readable when hovered in a dark toolbar", async () => {
  const view = await render(
    <div className="dark" style={{ "--primary-foreground": "#111111" } as React.CSSProperties}>
      <div data-slot="workspace-toolbar-shell">
        <div className="design-solid">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="nav-tab active"
            style={{ transition: "none" }}
          >
            Code hover contrast
          </button>
        </div>
      </div>
    </div>,
  );
  const button = page.getByRole("tab", { name: "Code hover contrast" });
  const initialColor = getComputedStyle(button.element()).color;
  await button.hover();
  await expect.poll(() => getComputedStyle(button.element()).color).toBe(initialColor);
  await view.unmount();
});

it("keeps the light rail gutter on the workspace surface and rounds both search ends", async () => {
  const snapshot = snapshotThemeState();
  vi.stubGlobal("desktopBridge", { setTheme: vi.fn(async () => {}) });
  try {
    restoreThemeSnapshot({ ...snapshot, theme: "tabs-light" });
    const view = await render(
      <div className="code-workspace bg-background">
        <CodeHeaderBar
          workspaceName="Tabs"
          activeFilePath="/workspace/.gitignore"
          branch={null}
          panelOpen={false}
          panelMaximized={false}
          sideChatOpen={false}
          sideChatLabel="Toggle Tabs AI chat"
          onToggleSideChat={() => {}}
          onRunCommand={() => {}}
          onMenuOpenChange={async () => {}}
        />
        <div className="code-workspace-body flex h-96">
          <CodeActivityRail chromeState={DEFAULT_CODE_CHROME_STATE} onRunCommand={() => {}} />
        </div>
      </div>,
    );
    const workspace = getComputedStyle(document.querySelector(".code-workspace")!);
    const gutter = getComputedStyle(document.querySelector(".code-workspace-body")!);
    const rail = getComputedStyle(document.querySelector(".code-activity-rail")!);
    const footer = getComputedStyle(document.querySelector(".code-workspace")!, "::before");
    const settings = getComputedStyle(document.querySelector(".code-rail-settings")!);
    expect(footer.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(footer.height).toBe("28px");
    expect(footer.bottom).toBe("0px");
    expect(settings.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(gutter.backgroundColor).toBe(workspace.backgroundColor);
    expect(gutter.backgroundColor).not.toBe(rail.backgroundColor);
    const search = getComputedStyle(document.querySelector(".code-quick-open")!);
    expect(search.borderTopLeftRadius).toBe(search.borderTopRightRadius);
    expect(parseFloat(search.borderTopLeftRadius)).toBeGreaterThanOrEqual(
      parseFloat(search.height) / 2,
    );
    await view.unmount();
  } finally {
    restoreThemeSnapshot(snapshot);
    vi.unstubAllGlobals();
  }
});

it("blurs and disables the Tabs chrome for native Code dialogs", async () => {
  const runCommand = vi.fn();
  const view = await render(
    <div className="code-workspace" data-modal-open="true">
      <CodeHeaderBar
        modalOpen
        workspaceName="Tabs"
        activeFilePath={null}
        branch={null}
        panelOpen={false}
        panelMaximized={false}
        sideChatOpen={false}
        sideChatLabel="Toggle Tabs AI chat"
        onToggleSideChat={() => {}}
        onRunCommand={runCommand}
        onMenuOpenChange={async () => {}}
      />
      <CodeActivityRail
        chromeState={{ ...DEFAULT_CODE_CHROME_STATE, modalOpen: true }}
        onRunCommand={runCommand}
      />
    </div>,
  );
  try {
    const header = document.querySelector<HTMLElement>(".code-command-strip")!;
    const rail = document.querySelector<HTMLElement>(".code-activity-rail")!;
    expect(header.inert).toBe(true);
    expect(rail.inert).toBe(true);
    // A single backdrop must span the gutters as well as the controls. Filtering
    // each control separately leaves bright, feathered seams at every edge.
    expect(getComputedStyle(header).filter).toBe("none");
    expect(getComputedStyle(rail).filter).toBe("none");
    const workspace = document.querySelector<HTMLElement>(".code-workspace")!;
    const backdrop = getComputedStyle(workspace, "::after");
    expect(backdrop.backdropFilter).toBe("blur(4px)");
    expect(backdrop.backgroundColor).toBe("rgba(0, 0, 0, 0.5)");
    expect([backdrop.top, backdrop.right, backdrop.bottom, backdrop.left]).toEqual([
      "0px",
      "0px",
      "0px",
      "0px",
    ]);
    expect(getComputedStyle(header, "::after").content).toBe("none");
    expect(getComputedStyle(rail, "::after").content).toBe("none");
    const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
    await userEvent.keyboard(`{${modifier}>}p{/${modifier}}`);
    expect(runCommand).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("moves the rail selection without moving targets and clears the native spotlight", async () => {
  const runCommand = vi.fn();
  const view = await render(
    <div className="code-workspace h-[600px]">
      <CodeActivityRail
        chromeState={{ ...DEFAULT_CODE_CHROME_STATE, activeViewId: "explorer" }}
        onRunCommand={runCommand}
      />
    </div>,
  );
  const explorer = page.getByRole("button", { name: "Explorer", exact: true });
  const search = page.getByRole("button", { name: "Search", exact: true });
  const bounds = explorer.element().getBoundingClientRect();
  expect(bounds.width).toBe(40);
  expect(bounds.height).toBe(40);
  const rail = document.querySelector<HTMLElement>(".code-activity-rail")!;
  rail.style.setProperty("--primary", "#0000ff");
  rail.style.setProperty("--vscode-focusBorder", "#ff0000");
  const glow = getComputedStyle(rail, "::before");
  // Native focus-token overrides must color both halves of the shared glow.
  expect(glow.backgroundImage).toContain("color(srgb 1 0 0");
  expect(rail.clientTop + parseFloat(glow.top)).toBe(0);
  expect(parseFloat(getComputedStyle(rail).borderBottomWidth) + parseFloat(glow.bottom)).toBe(0);
  expect(glow.borderTopLeftRadius).toBe(getComputedStyle(rail).borderTopLeftRadius);
  expect(parseFloat(rail.style.getPropertyValue("--code-rail-glow-y"))).toBeCloseTo(
    bounds.top + bounds.height / 2 - rail.getBoundingClientRect().top,
  );
  await userEvent.hover(explorer);
  await expect
    .poll(() => runCommand.mock.calls.at(-1)?.[0])
    .toBe(CODE_CHROME_COMMANDS.railSpotlightOn);
  expect(document.querySelector(".code-rail-views")!.hasAttribute("data-spotlight")).toBe(true);
  expect(explorer.element().getBoundingClientRect().y).toBe(bounds.y);
  await userEvent.hover(search);
  await expect
    .poll(() => runCommand.mock.calls.at(-1)?.[0])
    .toBe(CODE_CHROME_COMMANDS.railSpotlightOff);
  expect(document.querySelector(".code-rail-views")!.hasAttribute("data-spotlight")).toBe(false);
  await userEvent.hover(explorer);
  await expect
    .poll(() => runCommand.mock.calls.at(-1)?.[0])
    .toBe(CODE_CHROME_COMMANDS.railSpotlightOn);
  await view.unmount();
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.railSpotlightOff);
});

it("keeps the moving selection and keyboard navigation aligned with the active view", async () => {
  function InteractiveRail() {
    const [active, setActive] = useState<"explorer" | "search">("explorer");
    return (
      <div className="code-workspace h-[600px]">
        <CodeActivityRail
          chromeState={{ ...DEFAULT_CODE_CHROME_STATE, activeViewId: active }}
          onRunCommand={(id) => {
            if (id === "workbench.view.search") setActive("search");
            if (id === "workbench.view.explorer") setActive("explorer");
          }}
        />
      </div>
    );
  }
  const view = await render(<InteractiveRail />);
  const views = document.querySelector<HTMLElement>(".code-rail-views")!;
  const explorer = page.getByRole("button", { name: "Explorer", exact: true });
  const search = page.getByRole("button", { name: "Search", exact: true });
  const firstY = views.style.getPropertyValue("--code-selection-y");
  await search.click();
  await expect.element(search).toHaveAttribute("aria-pressed", "true");
  await expect.element(explorer).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => views.style.getPropertyValue("--code-selection-y")).not.toBe(firstY);
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(explorer).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(explorer).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => views.style.getPropertyValue("--code-selection-y")).toBe(firstY);
  await view.unmount();
});

it("keeps the glow on the full rail and clears spotlight while scrolling a short window", async () => {
  const runCommand = vi.fn();
  const view = await render(
    <div className="code-workspace flex h-[240px]">
      <CodeActivityRail
        chromeState={{ ...DEFAULT_CODE_CHROME_STATE, activeViewId: "explorer" }}
        onRunCommand={runCommand}
      />
    </div>,
  );
  const rail = document.querySelector<HTMLElement>(".code-activity-rail")!;
  const scroll = document.querySelector<HTMLElement>(".code-rail-scroll")!;
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  await userEvent.hover(page.getByRole("button", { name: "Explorer", exact: true }));
  await expect
    .poll(() => runCommand.mock.calls.at(-1)?.[0])
    .toBe(CODE_CHROME_COMMANDS.railSpotlightOn);
  scroll.scrollTop = scroll.scrollHeight;
  await expect.poll(() => rail.hasAttribute("data-has-selection")).toBe(false);
  await expect.poll(() => rail.hasAttribute("data-spotlight")).toBe(false);
  expect(runCommand).toHaveBeenLastCalledWith(CODE_CHROME_COMMANDS.railSpotlightOff);
  scroll.scrollTop = 0;
  await expect.poll(() => rail.hasAttribute("data-has-selection")).toBe(true);
  await view.unmount();
});

it("paints the glow through the facing border without an unlit strip at the native join", async () => {
  const view = await render(
    <div className="code-workspace flex h-[600px]">
      <CodeActivityRail
        chromeState={{ ...DEFAULT_CODE_CHROME_STATE, activeViewId: "explorer" }}
        onRunCommand={vi.fn()}
      />
    </div>,
  );
  const rail = document.querySelector<HTMLElement>(".code-activity-rail")!;
  const glow = getComputedStyle(rail, "::before");
  // An absolute pseudo-element's containing block excludes its parent's border.
  // Both ends must reach the border box, including the transparent joining edge.
  expect(rail.clientLeft + parseFloat(glow.left)).toBeCloseTo(0);
  expect(rail.clientTop + parseFloat(glow.top)).toBeCloseTo(0);
  expect(rail.clientLeft + parseFloat(glow.left) + parseFloat(glow.width)).toBeCloseTo(
    rail.offsetWidth,
  );
  expect(rail.clientTop + parseFloat(glow.top) + parseFloat(glow.height)).toBeCloseTo(
    rail.offsetHeight,
  );
  await view.unmount();
});

it("bridges complete labels to the native pane without rendering a clipped React popup", async () => {
  const presentation = vi.fn<(value: CodeRailPresentation) => void>();
  const runCommand = vi.fn();
  const view = await render(
    <div className="code-workspace flex h-[600px]">
      <CodeActivityRail
        chromeState={{ ...DEFAULT_CODE_CHROME_STATE, activeViewId: "explorer" }}
        onRunCommand={runCommand}
        onPresentationChange={presentation}
      />
    </div>,
  );
  await expect.poll(() => presentation.mock.calls.at(-1)?.[0].selectionY).toBeGreaterThan(0);
  await userEvent.hover(page.getByRole("button", { name: "Source Control", exact: true }));
  await expect.poll(() => presentation.mock.calls.at(-1)?.[0].label?.text).toBe("Source Control");
  expect(presentation.mock.calls.at(-1)![0].label!.y).toBeGreaterThan(0);
  expect(presentation.mock.calls.at(-1)![0].label!.y).toBeLessThan(1);
  expect(document.querySelector('[data-slot="tooltip-popup"]')).toBeNull();
  expect(runCommand).not.toHaveBeenCalled();
  await userEvent.hover(page.getByRole("button", { name: "Explorer", exact: true }));
  await expect.poll(() => presentation.mock.calls.at(-1)?.[0].spotlight).toBe(true);
  await expect.poll(() => presentation.mock.calls.at(-1)?.[0].label).toBeNull();
  await view.unmount();
  expect(presentation).toHaveBeenLastCalledWith({
    selectionY: null,
    spotlight: false,
    label: null,
  });
});
