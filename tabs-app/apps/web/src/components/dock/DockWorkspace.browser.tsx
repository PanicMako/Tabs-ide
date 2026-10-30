import "../../index.css";
import { beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type {
  ResourceTelemetrySnapshot,
  ResourceTelemetryProcess,
  TerminalAttachStreamEvent,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import type { DockTelemetryApi } from "./useDockResources";
import { DockWorkspace, type DockPreset } from "./DockWorkspace";
import { useDockState } from "./dockState";
import { snapshotThemeState, previewTheme, restoreThemeSnapshot } from "../../hooks/useTheme";
const presets: DockPreset[] = [
  {
    id: "fe",
    label: "Frontend",
    commands: ["npm run dev"],
    cwd: "/project/web",
    autoStart: false,
    env: { NODE_ENV: "development" },
    previewUrl: "http://localhost:5173",
    dependsOn: ["be"],
  },
  {
    id: "be",
    label: "Backend",
    commands: ["npm run server"],
    cwd: "/project/api",
    autoStart: true,
    env: {},
  },
  {
    id: "db",
    label: "Database",
    commands: ["npm run studio"],
    cwd: "/project",
    autoStart: false,
    env: {},
  },
];
const calls = {
  terminal: vi.fn(),
  run: vi.fn(),
  restart: vi.fn(),
  stop: vi.fn(),
  activate: vi.fn(),
  save: vi.fn(),
  add: vi.fn(),
  manage: vi.fn(),
  delete: vi.fn(),
  preview: vi.fn(),
  inspect: vi.fn(),
  agent: vi.fn(async (_text: string) => {}),
};
let listeners: Record<string, (event: TerminalAttachStreamEvent) => void> = {};
const stopStream = vi.fn();
const stopTelemetry = vi.fn();
let telemetryListener: ((snapshot: ResourceTelemetrySnapshot) => void) | undefined;
function telemetry(status = "healthy", sampledAt = Date.now()): ResourceTelemetrySnapshot {
  const proc = (pid: number, ppid: number, cpuPercent: number, residentBytes: number) =>
    ({
      identity: { pid, startTimeMs: 1000 },
      ppid,
      cpuPercent,
      residentBytes,
      runTimeMs: 4_061_000,
    }) as ResourceTelemetryProcess;
  return {
    readAt: DateTime.makeUnsafe(sampledAt),
    sampleIntervalMs: 1000,
    health: { native: { status } },
    processes: [
      proc(121, 1, 64, 29_000_000),
      proc(221, 121, 160, 400_000_000),
      proc(122, 1, 8, 200_000_000),
    ],
  } as unknown as ResourceTelemetrySnapshot;
}
const api = {
  terminal: {
    attach: vi.fn(
      (input: { terminalId: string }, callback: (event: TerminalAttachStreamEvent) => void) => {
        listeners[input.terminalId] = callback;
        callback({
          type: "snapshot",
          snapshot: {
            threadId: "dock",
            terminalId: input.terminalId,
            cwd: "/project",
            worktreePath: null,
            status: "running",
            pid: input.terminalId === "fe" ? 121 : 122,
            history:
              input.terminalId === "fe"
                ? "Vite ready\nLocal http://localhost:5173\n"
                : "Error: database connection failed\n",
            exitCode: null,
            exitSignal: null,
            label: input.terminalId,
            updatedAt: new Date().toISOString(),
          },
        });
        return stopStream;
      },
    ),
  },
  server: {
    getHostResources: vi.fn(async () => ({
      sampledAt: Date.now(),
      cpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
      availableMemoryBytes: 8_000_000_000,
      cpuUtilization: null,
    })),
    onResourceTelemetry: vi.fn((callback: (snapshot: ResourceTelemetrySnapshot) => void) => {
      telemetryListener = callback;
      callback(telemetry());
      return stopTelemetry;
    }),
  },
} as unknown as DockTelemetryApi;
const renderTerminal = vi.fn((id: string) => (
  <div
    role="region"
    aria-label={`Live terminal ${id}`}
    style={{ padding: 18, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.8 }}
  >
    {id === "fe" ? (
      <>
        <div>$ npm run dev</div>
        <br />
        <div>Vite ready</div>
        <div>Local: http://localhost:5173/</div>
      </>
    ) : id === "be" ? (
      <>
        <div>$ npm run server</div>
        <br />
        <div>Error: database connection failed</div>
      </>
    ) : (
      <div>
        project % <span aria-hidden="true">▌</span>
      </div>
    )}
  </div>
));
beforeEach(() => {
  useDockState.setState({ views: {} });
  listeners = {};
  Object.values(calls).forEach((fn) => fn.mockClear());
  stopStream.mockClear();
  stopTelemetry.mockClear();
  telemetryListener = undefined;
  renderTerminal.mockClear();
});
async function mount(empty = false, manual = false, extra = false, height = 760) {
  return render(
    <div style={{ height }}>
      <DockWorkspace
        scope="project-a"
        projectName="Tabs"
        cwd="/project"
        presets={empty || manual ? [] : presets}
        terminalIds={empty ? [] : manual ? ["shell"] : extra ? ["fe", "be", "db"] : ["fe", "be"]}
        runningIds={empty || manual ? [] : ["fe", "be"]}
        activeTerminalId={manual ? "shell" : "fe"}
        threadId="dock"
        api={api}
        renderTerminal={renderTerminal}
        onRun={calls.run}
        onRestart={calls.restart}
        onStop={calls.stop}
        onActivate={calls.activate}
        onNewTerminal={calls.terminal}
        onCloseAll={vi.fn()}
        onAdd={calls.add}
        onManage={calls.manage}
        onDelete={calls.delete}
        onSave={calls.save}
        onPreview={calls.preview}
        onInspectPreview={calls.inspect}
        canInspectPreview
        onAddToAgent={calls.agent}
      />
    </div>,
  );
}
it("arranges real terminal panes and swaps presets using drag and drop", async () => {
  await page.viewport(1440, 900);
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Arrange Dock panes" }).click();
    await page.getByRole("button", { name: "Side by side", exact: true }).click();
    await expect.element(page.getByRole("region", { name: "Live terminal fe" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Live terminal be" })).toBeVisible();
    const target = page.getByRole("region", { name: "Dock pane 1", exact: true }).element();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/x-tabs-dock-preset", "be");
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    await expect.poll(() => useDockState.getState().views["project-a"]?.slots[0]).toBe("be");
    expect(useDockState.getState().views["project-a"]?.slots[1]).toBe("fe");
    expect(calls.run).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Stop Backend", exact: true }).click();
    expect(calls.stop).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => calls.stop.mock.calls.length).toBe(1);
    expect(calls.stop).toHaveBeenCalledWith("be");
    await page.getByRole("tab", { name: "Database", exact: true }).click();
    await expect
      .element(page.getByRole("heading", { name: "Database", exact: true }))
      .toBeVisible();
    expect(useDockState.getState().views["project-a"]?.layout).toBe("focus");
    expect(calls.run).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
it("edits a preset without dropping environment or dependency settings and uses the existing preview route", async () => {
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Web app");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(calls.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fe",
        label: "Web app",
        env: { NODE_ENV: "development" },
        dependsOn: ["be"],
      }),
    );
    await page.getByRole("button", { name: "Open preview inspector" }).click();
    expect(calls.inspect).toHaveBeenCalledWith(presets[0]);
  } finally {
    await view.unmount();
  }
});
it("keeps live terminal panes mounted while captured output updates", async () => {
  const view = await mount();
  try {
    const renders = renderTerminal.mock.calls.length;
    listeners.fe!({ type: "output", threadId: "dock", terminalId: "fe", data: "new output\n" });
    await page.getByRole("button", { name: "Output", exact: true }).click();
    await expect.element(page.getByRole("log")).toHaveTextContent("new output");
    expect(renderTerminal.mock.calls.length).toBe(renders);
    expect(stopStream).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});
it("captures real output, filters failures and adds context to a draft without sending", async () => {
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Output", exact: true }).click();
    await expect
      .element(page.getByRole("log", { name: "Dock captured output" }))
      .toHaveTextContent("database connection failed");
    await page.getByRole("button", { name: "Errors only", exact: true }).click();
    await expect.element(page.getByRole("log")).not.toHaveTextContent("Vite ready");
    await page.getByRole("button", { name: "Add to draft", exact: true }).click();
    await expect.poll(() => calls.agent.mock.calls.length).toBe(1);
    expect(calls.agent.mock.calls[0]?.[0]).toContain("database connection failed");
    expect(calls.agent.mock.calls[0]?.[0]).toContain("/project/web");
  } finally {
    await view.unmount();
  }
  expect(stopStream).toHaveBeenCalled();
});
it("keeps layout choices after remount and fits themes and smaller windows", async () => {
  const original = snapshotThemeState();
  useDockState.getState().update("project-a", {
    layout: "main-stack",
    services: true,
    slots: ["fe", "be", "db", null],
    inspector: false,
  });
  try {
    for (const width of [1440, 768, 390]) {
      await page.viewport(width, 900);
      previewTheme(width === 768 ? "tabs-light" : "true-black");
      const view = await mount(false, false, true);
      try {
        await expect
          .element(page.getByRole("region", { name: "Dock pane 3", exact: true }))
          .toBeVisible();
        const root = view.container.querySelector<HTMLElement>(".dock-workspace")!;
        const header = root.querySelector<HTMLElement>(".dock-topbar")!;
        const canvas = root.querySelector<HTMLElement>(".dock-canvas")!;
        expect(parseFloat(getComputedStyle(header).borderWidth)).toBe(1);
        expect(parseFloat(getComputedStyle(header).borderRadius)).toBe(36);
        expect(parseFloat(getComputedStyle(canvas).borderRadius)).toBe(36);
        expect(
          canvas.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
        ).toBeGreaterThanOrEqual(9);
        if (width === 1440) {
          await expect.element(page.getByRole("region", { name: "Running presets" })).toBeVisible();
          await expect.element(page.getByRole("region", { name: "Ready presets" })).toBeVisible();
        }
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
        expect(useDockState.getState().views["project-a"]?.layout).toBe("main-stack");
        await page.screenshot({
          element: view.container,
          path: `__screenshots__/dock/workspace-${width}.png`,
        });
        if (width === 1440) {
          await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
          await page.screenshot({
            element: view.container,
            path: "__screenshots__/dock/inspector.png",
          });
          await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
        }
      } finally {
        await view.unmount();
      }
    }
  } finally {
    restoreThemeSnapshot(original);
    await page.viewport(1280, 900);
  }
});

it("previews the two launch choices without executing them and keeps the empty state responsive", async () => {
  const original = snapshotThemeState();
  try {
    for (const width of [1440, 768, 390]) {
      previewTheme(width === 768 ? "tabs-light" : width === 390 ? "tabs-dark" : "true-black");
      await page.viewport(width, 900);
      const view = await mount(true);
      try {
        await expect.element(page.getByRole("heading", { name: "Start something." })).toBeVisible();
        expect(view.container.querySelector(".dock-services")).toBeNull();
        const root = view.container.querySelector<HTMLElement>(".dock-workspace")!;
        const launchpad = view.container.querySelector<HTMLElement>(".dock-launchpad")!;
        const bench = view.container.querySelector<HTMLElement>(".dock-launchpad-bench")!;
        const before = bench.getBoundingClientRect().toJSON();
        expect(parseFloat(getComputedStyle(bench).borderRadius)).toBe(36);
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
        const preset = page.getByRole("button", { name: "Create a preset", exact: true });
        const terminal = page.getByRole("button", { name: "Open a terminal", exact: true });
        if (width > 600) {
          expect(parseFloat(getComputedStyle(terminal.element()).borderBottomLeftRadius)).toBe(36);
          expect(parseFloat(getComputedStyle(terminal.element()).borderBottomRightRadius)).toBe(36);
          expect(parseFloat(getComputedStyle(preset.element()).borderBottomRightRadius)).toBe(36);
          expect(parseFloat(getComputedStyle(preset.element()).borderBottomLeftRadius)).toBe(36);
        }
        await userEvent.hover(preset);
        expect(launchpad.dataset.preview).toBe("preset");
        expect(calls.add).not.toHaveBeenCalled();
        expect(calls.terminal).not.toHaveBeenCalled();
        expect(bench.getBoundingClientRect().toJSON()).toEqual(before);
        await Promise.all(
          launchpad.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
        await page.screenshot({
          element: view.container,
          path: `__screenshots__/dock/launchpad-preset-${width}.png`,
        });
        await preset.click();
        expect(calls.add).toHaveBeenCalledTimes(1);
        expect(calls.run).not.toHaveBeenCalled();
        await userEvent.hover(terminal);
        expect(launchpad.dataset.preview).toBe("terminal");
        await Promise.all(
          launchpad.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
        await page.screenshot({
          element: view.container,
          path: `__screenshots__/dock/launchpad-shell-${width}.png`,
        });
        await terminal.click();
        expect(calls.terminal).toHaveBeenCalledTimes(1);
        calls.add.mockClear();
        calls.terminal.mockClear();
      } finally {
        await view.unmount();
      }
    }
  } finally {
    restoreThemeSnapshot(original);
    await page.viewport(1280, 900);
  }
});

it("previews launch choices from the keyboard and respects reduced motion", async () => {
  const previous = document.documentElement.dataset.reducedMotion;
  const view = await mount(true);
  try {
    document.documentElement.dataset.reducedMotion = "reduce";
    const preset = page.getByRole("button", { name: "Create a preset", exact: true });
    const terminal = page.getByRole("button", { name: "Open a terminal", exact: true });
    terminal.element().focus();
    expect(view.container.querySelector<HTMLElement>(".dock-launchpad")!.dataset.preview).toBe(
      "terminal",
    );
    await userEvent.keyboard("{Tab}");
    await expect.element(preset).toHaveFocus();
    expect(view.container.querySelector<HTMLElement>(".dock-launchpad")!.dataset.preview).toBe(
      "preset",
    );
    expect(calls.add).not.toHaveBeenCalled();
    expect(
      getComputedStyle(view.container.querySelector(".dock-launchpad-scene")!).transitionDuration,
    ).toBe("0s");
    await userEvent.keyboard("{Enter}");
    expect(calls.add).toHaveBeenCalledTimes(1);
  } finally {
    if (previous) document.documentElement.dataset.reducedMotion = previous;
    else delete document.documentElement.dataset.reducedMotion;
    await view.unmount();
  }
});

it("opens in focus with the preset launcher and preserves terminal DOM across keyboard tabs and output", async () => {
  await page.viewport(1440, 900);
  const view = await mount();
  try {
    expect(view.container.querySelector(".dock-services")).not.toBeNull();
    expect(view.container.querySelector(".dock-inspector")).toBeNull();
    expect(view.container.querySelector(".dock-canvas-toolbar")).toBeNull();
    const terminal = view.container.querySelector('[aria-label="Live terminal fe"]');
    await page.getByRole("tab", { name: "Frontend", exact: true }).click();
    await page.getByRole("tab", { name: "Frontend", exact: true }).element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(page.getByRole("tab", { name: "Backend", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Frontend", exact: true }).click();
    await page.getByRole("button", { name: "Output", exact: true }).click();
    await page.getByRole("button", { name: "Return to terminals" }).click();
    expect(view.container.querySelector('[aria-label="Live terminal fe"]')).toBe(terminal);
    await page.screenshot({ element: view.container, path: "__screenshots__/dock/focus.png" });
  } finally {
    await view.unmount();
  }
});
it("shows service tree metrics and clears unavailable readings without stopping the terminal", async () => {
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("28.0%");
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("429 MB");
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("2.7% of host RAM");
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("1:07:41");
    telemetryListener?.(telemetry("healthy", Date.now() + 1000));
    await page.screenshot({ element: view.container, path: "__screenshots__/dock/resources.png" });
    telemetryListener?.(telemetry("unavailable"));
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("Unavailable");
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .not.toHaveTextContent("429 MB");
    await expect.element(page.getByRole("region", { name: "Live terminal fe" })).toBeVisible();
  } finally {
    await view.unmount();
  }
  expect(stopTelemetry).toHaveBeenCalled();
});

it("gives a standalone shell its own tab and resource inspector", async () => {
  const original = snapshotThemeState();
  previewTheme("tabs-dark");
  await page.viewport(1440, 900);
  const view = await mount(false, true);
  try {
    await expect.element(page.getByRole("tab", { name: "shell", exact: true })).toBeVisible();
    expect(view.container.querySelector(".dock-services")).not.toBeNull();
    expect(view.container.querySelector(".dock-canvas-toolbar")).toBeNull();
    expect(page.getByRole("button", { name: "Restart shell", exact: true }).query()).toBeNull();
    await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
    await expect
      .element(page.getByRole("region", { name: "Process resources" }))
      .toHaveTextContent("200 MB");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/dock/manual-terminal.png",
    });
    view.container
      .querySelector(".dock-inspector")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.poll(() => view.container.querySelector(".dock-inspector")).toBeNull();
  } finally {
    await view.unmount();
    restoreThemeSnapshot(original);
  }
});

it("keeps connected folder tabs independent of the theme's rounded control radius", async () => {
  const original = snapshotThemeState();
  await page.viewport(1440, 900);
  try {
    for (const theme of ["tabs-dark", "tabs-light", "true-black"] as const) {
      previewTheme(theme);
      const view = await mount();
      try {
        const tab = page.getByRole("tab", { name: "Backend", exact: true });
        await tab.click();
        const wrapper = tab.element().parentElement!;
        const style = getComputedStyle(tab.element());
        expect(style.borderTopLeftRadius).toBe("12px");
        expect(style.borderBottomLeftRadius).toBe("0px");
        expect(getComputedStyle(wrapper, "::before").content).not.toBe("none");
        expect(getComputedStyle(wrapper, "::after").borderBottomLeftRadius).toBe("12px");
        const bar = view.container.querySelector(".dock-document-bar")!;
        expect(
          Math.abs(wrapper.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(1);
        const pane = view.container.querySelector(".dock-pane-focus > .dock-pane")!;
        expect(getComputedStyle(pane).borderTopWidth).toBe("0px");
        expect(getComputedStyle(pane).borderTopLeftRadius).toBe("0px");
        await expect
          .element(page.getByRole("button", { name: "Close Backend terminal", exact: true }))
          .toBeVisible();
        await page.screenshot({
          element: view.container,
          path: `__screenshots__/dock/restored-tabs-${theme}.png`,
        });
      } finally {
        await view.unmount();
      }
    }
  } finally {
    restoreThemeSnapshot(original);
    await page.viewport(1280, 900);
  }
});

it("keeps the status strip integrated and fits the idle preset inspector without clipped commands", async () => {
  const original = snapshotThemeState();
  previewTheme("true-black");
  await page.viewport(1440, 1040);
  const view = await mount(false, false, false, 1000);
  try {
    await page.getByRole("tab", { name: "Database", exact: true }).click();
    await page.getByRole("button", { name: "Toggle Dock inspector" }).click();
    const inspector = view.container.querySelector<HTMLElement>(".dock-inspector")!;
    const footer = view.container.querySelector(".dock-session-bar")!;
    expect(getComputedStyle(footer).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(footer).borderTopLeftRadius).toBe("18px");
    expect(getComputedStyle(footer).marginBottom).toBe("0px");
    expect(inspector.querySelector(".dock-usage-chart")).toBeNull();
    expect(inspector.textContent).toContain("Not running");
    const commands = page.getByRole("textbox", { name: "Commands, in order" });
    await expect.element(commands).toHaveValue("npm run studio");
    expect(getComputedStyle(commands.element()).borderTopLeftRadius).toBe("8px");
    expect(inspector.scrollHeight).toBeLessThanOrEqual(inspector.clientHeight);
    await expect
      .element(page.getByRole("button", { name: "Save changes", exact: true }))
      .toBeVisible();
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/dock/inspector-idle-fit.png",
    });
  } finally {
    await view.unmount();
    restoreThemeSnapshot(original);
    await page.viewport(1280, 900);
  }
});

it("confirms terminal tab closure and preserves the saved preset on cancellation and close", async () => {
  const original = snapshotThemeState();
  previewTheme("tabs-dark");
  await page.viewport(1440, 900);
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Close Frontend terminal", exact: true }).click();
    await expect.element(page.getByRole("alertdialog")).toHaveTextContent('Close "Frontend"?');
    expect(calls.stop).not.toHaveBeenCalled();
    await page.screenshot({
      element: document.body,
      path: "__screenshots__/dock/close-confirmation.png",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByRole("tab", { name: "Frontend", exact: true })).toBeVisible();
    expect(calls.stop).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Close Frontend terminal", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("alertdialog").query()).toBeNull();
    expect(calls.stop).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Close Frontend terminal", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => calls.stop.mock.calls.length).toBe(1);
    expect(calls.stop).toHaveBeenCalledWith("fe");
    expect(page.getByRole("tab", { name: "Frontend", exact: true }).query()).toBeNull();
    await page.getByRole("button", { name: "Select Frontend preset", exact: true }).click();
    await expect.element(page.getByRole("tab", { name: "Frontend", exact: true })).toBeVisible();
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/dock/editor-tabs.png",
    });
  } finally {
    await view.unmount();
    restoreThemeSnapshot(original);
  }
});

it("keeps presets runnable in the collapsed rail and exposes contextual editing", async () => {
  const view = await mount();
  try {
    await expect
      .element(page.getByRole("button", { name: "Toggle Dock presets" }))
      .toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Select Frontend preset" }).hover();
    await page.getByRole("button", { name: "Edit Frontend preset" }).click();
    expect(calls.manage).toHaveBeenCalledWith("fe");
    await page.getByRole("button", { name: "Delete Frontend preset" }).click();
    expect(calls.delete).toHaveBeenCalledWith("fe");
    await page.getByRole("button", { name: "Toggle Dock presets" }).click();
    await page.getByRole("button", { name: "Run Database", exact: true }).click();
    expect(calls.run).toHaveBeenCalledWith("db");
    await expect
      .element(page.getByRole("button", { name: "Toggle Dock presets" }))
      .toHaveAttribute("aria-expanded", "false");
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/dock/preset-rail.png",
    });
  } finally {
    await view.unmount();
  }
});
it("tiles only open terminals, with one heading per pane and no duplicate tab or selector bars", async () => {
  const original = snapshotThemeState();
  previewTheme("tabs-dark");
  const view = await mount();
  try {
    await page.getByRole("button", { name: "Arrange Dock panes" }).click();
    await expect
      .element(page.getByRole("button", { name: "Four panes", exact: true }))
      .toBeDisabled();
    await page.screenshot({
      element: document.body,
      path: "__screenshots__/dock/arrange-menu.png",
    });
    await page.getByRole("button", { name: "Side by side", exact: true }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "Side by side", exact: true }).query())
      .toBeNull();
    expect(view.container.querySelector('[role="tablist"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="select-trigger"]')).toBeNull();
    await expect.element(page.getByRole("region", { name: "Live terminal fe" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Live terminal be" })).toBeVisible();
    await page.screenshot({
      element: view.container,
      path: "__screenshots__/dock/tiled-terminals.png",
    });
  } finally {
    await view.unmount();
    restoreThemeSnapshot(original);
  }
});
