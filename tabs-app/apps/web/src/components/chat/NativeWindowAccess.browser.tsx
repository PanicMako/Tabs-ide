import "../../index.css";
import {
  EnvironmentId,
  ThreadId,
  type NativeComputerCommand,
  type NativeComputerState,
} from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { NativeWindowAccess } from "./NativeWindowAccess";
import { toastManager } from "../ui/toast";
import {
  NATIVE_WINDOW_UPDATED_EVENT,
  runNativeWindowHandoff,
  type NativeWindowUpdate,
} from "~/lib/nativeWindowHandoff";

const { dispatchCommand, environmentApi } = vi.hoisted(() => {
  const dispatchCommand = vi.fn(async (_command: unknown) => ({}));
  return {
    dispatchCommand,
    environmentApi: vi.fn(async (_environmentId?: string | null) => ({
      orchestration: { dispatchCommand },
    })),
  };
});
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

function publish(detail: NativeWindowUpdate) {
  window.dispatchEvent(new CustomEvent(NATIVE_WINDOW_UPDATED_EVENT, { detail }));
}

it("attaches one matching window by keyboard and takes, returns, and revokes control", async () => {
  const threadId = ThreadId.make("fixture-thread");
  const environmentId = EnvironmentId.make("native-owner");
  const frame = { x: 100, y: 100, width: 900, height: 640 };
  const first = { id: "first", app: "Example", title: "Duplicate title", pid: 107, frame };
  const second = { ...first, id: "second", frame: { ...frame, x: -900 } };
  let grant: NativeComputerState["grant"] = null;
  const request = vi.fn(async (input: NativeComputerCommand): Promise<NativeComputerState> => {
    switch (input.op) {
      case "list":
        return {
          grant,
          windows: [first, second],
          capabilities: {
            session: "windows",
            windowSelection: true,
            accessibilityActions: true,
            windowCapture: true,
            foregroundInput: true,
            details: "Interactive fixture",
          },
        };
      case "attach":
        grant = {
          window: second,
          selector: "window:approved",
          mode: "agent",
          foreground: input.foreground,
        };
        break;
      case "take":
        if (grant) grant = { ...grant, mode: "user", takeoverId: "takeover-1" };
        break;
      case "resume":
        if (!grant) return { grant };
        grant = { ...grant, mode: "agent" };
        return { grant, continuationId: "native-demo-1" };
      case "revoke":
        grant = null;
        break;
      case "status":
        break;
    }
    return { grant };
  });
  const attachToDraft = vi.fn<(file: File) => void>();
  await render(
    <NativeWindowAccess
      enabled
      location={{ environmentId, projectId: "example", threadId }}
      request={request}
      attachToDraft={attachToDraft}
    />,
  );

  await page.getByRole("button", { name: "Attach desktop window" }).click();
  const window = page.getByRole("radio", { name: /-900, 100/ });
  await expect.element(window).toBeVisible();
  const radio = await window.element();
  (radio as HTMLInputElement).focus();
  await userEvent.keyboard(" ");
  await expect.element(window).toBeChecked();
  await page.getByRole("button", { name: "Allow and attach" }).click();
  await expect
    .element(page.getByRole("button", { name: "Desktop window: Duplicate title" }))
    .toHaveAttribute("title", "Example · PID 107 · 900×640 at -900, 100");
  expect(request).toHaveBeenCalledWith({
    op: "attach",
    threadId,
    windowId: "second",
    foreground: false,
  });
  const file = attachToDraft.mock.calls[0]?.[0];
  if (!file) throw new Error("The window was not attached to the draft.");
  expect(file.type).toBe("application/vnd.tabs.surface+json");
  expect(JSON.parse(await file.text())).toMatchObject({
    projectId: "example",
    threadId,
    target: { kind: "native-window", selector: "window:approved" },
  });

  await page.getByRole("button", { name: "My turn" }).click();
  await expect.element(page.getByText("You have control")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Meaning of the demonstrated window step" })
    .fill("Export the selected rows");
  await page.getByRole("button", { name: "Return to agent" }).click();
  await expect.element(page.getByText("Agent has control")).toBeVisible();
  expect(request).toHaveBeenCalledWith({
    op: "resume",
    threadId,
    selector: "window:approved",
    takeoverId: "takeover-1",
    meaning: "Export the selected rows",
  });
  await vi.waitFor(() =>
    expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith({
      type: "message.dispatch",
      commandId: "native-demo-1",
      messageId: "native-demo-1",
      threadId,
      text: expect.stringContaining("computer_snapshot with this selector"),
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
    }),
  );
  expect(dispatchCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.not.stringMatching(/Example|Duplicate title|Export the selected rows/),
    }),
  );
  expect(environmentApi).toHaveBeenCalledExactlyOnceWith(environmentId);
  expect(request).toHaveBeenLastCalledWith({ op: "status", threadId });
  await page.getByRole("button", { name: "Stop agent" }).click();
  await expect.element(page.getByRole("button", { name: "Attach desktop window" })).toBeVisible();
});

const capabilitiesWindow = {
  id: "desktop-report",
  app: "Example",
  title: "Report",
  pid: 107,
  frame: { x: 8, y: 8, width: 800, height: 600 },
};
const x11Capabilities = {
  session: "x11",
  windowSelection: true,
  accessibilityActions: true,
  windowCapture: true,
  foregroundInput: true,
  details: "X11 AT-SPI accessibility is available. Scoped capture uses the X11 compositor.",
} as const;
const waylandCapabilities = {
  ...x11Capabilities,
  session: "wayland",
  windowCapture: false,
  foregroundInput: false,
  details: "Wayland AT-SPI accessibility is available. Advertised portals: ScreenCast.",
} as const;
const capabilitiesLocation = {
  projectId: "example",
  environmentId: null,
  threadId: ThreadId.make("native-capabilities"),
};
const physicalInputLabel = /Allow physical mouse and keyboard input/;

it("uses refreshed Wayland capabilities even after physical input was checked on X11", async () => {
  let capabilities: typeof x11Capabilities | typeof waylandCapabilities = x11Capabilities;
  const request = vi.fn(async (input: NativeComputerCommand): Promise<NativeComputerState> => {
    if (input.op === "list") return { grant: null, windows: [capabilitiesWindow], capabilities };
    if (input.op === "attach")
      return {
        grant: {
          window: capabilitiesWindow,
          selector: "window:wayland",
          mode: "agent",
          foreground: input.foreground,
        },
      };
    return { grant: null };
  });
  await render(
    <NativeWindowAccess
      enabled
      location={capabilitiesLocation}
      request={request}
      attachToDraft={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Attach desktop window" }).click();
  await expect.element(page.getByText("Window capture available")).toBeVisible();
  const physicalInput = page.getByRole("checkbox", { name: physicalInputLabel });
  await physicalInput.click();
  await expect.element(physicalInput).toBeChecked();
  await page.getByRole("radio", { name: /Report/ }).click();

  capabilities = waylandCapabilities;
  await page.getByRole("button", { name: "Refresh windows" }).click();
  await expect.element(page.getByText(/Advertised portals: ScreenCast/)).toBeVisible();
  await expect.element(page.getByText("Accessibility actions available")).toBeVisible();
  await expect.element(page.getByText("Window capture unavailable")).toBeVisible();
  await expect.element(page.getByText("Physical input unavailable")).toBeVisible();
  await expect.element(physicalInput).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Allow and attach" }).click();
  await expect.element(page.getByText("Agent has control", { exact: true })).toBeVisible();
  expect(request).toHaveBeenLastCalledWith({
    op: "attach",
    threadId: capabilitiesLocation.threadId,
    windowId: capabilitiesWindow.id,
    foreground: false,
  });
});

it("shows runtime foreground activity for a Windows grant and clears it on takeover", async () => {
  let grant: NativeComputerState["grant"] = null;
  let activity: NonNullable<NativeComputerState["activity"]> = "background";
  let perMonitorDpiAvailable = false;
  const request = vi.fn(async (input: NativeComputerCommand): Promise<NativeComputerState> => {
    if (input.op === "list")
      return {
        grant,
        windows: [capabilitiesWindow],
        capabilities: {
          ...x11Capabilities,
          session: "windows",
          windowCapture: perMonitorDpiAvailable,
          foregroundInput: perMonitorDpiAvailable,
          details: perMonitorDpiAvailable
            ? "Windows UI Automation is available on the interactive desktop."
            : "Windows UI Automation is available. Per-monitor DPI mapping is unavailable.",
        },
      };
    if (input.op === "attach")
      grant = {
        window: capabilitiesWindow,
        selector: "window:physical",
        mode: "agent",
        foreground: input.foreground,
      };
    if (input.op === "take" && grant) grant = { ...grant, mode: "user" };
    if (input.op === "resume" && grant) {
      grant = { ...grant, mode: "agent" };
      return { grant };
    }
    if (input.op === "status") return { grant, activity };
    return { grant };
  });
  const access = (activeAgentTurn: boolean) => (
    <NativeWindowAccess
      enabled
      activeAgentTurn={activeAgentTurn}
      location={capabilitiesLocation}
      request={request}
      attachToDraft={vi.fn()}
    />
  );
  const view = await render(access(false));
  await page.getByRole("button", { name: "Attach desktop window" }).click();
  const physicalInput = page.getByRole("checkbox", { name: physicalInputLabel });
  await expect.element(page.getByText("Window capture unavailable")).toBeVisible();
  await expect.element(physicalInput).not.toBeInTheDocument();
  perMonitorDpiAvailable = true;
  await page.getByRole("button", { name: "Refresh windows" }).click();
  await expect.element(page.getByText("Window capture available")).toBeVisible();
  await expect.element(physicalInput).not.toBeChecked();
  await physicalInput.click();
  await page.getByRole("radio", { name: /Report/ }).click();
  await page.getByRole("button", { name: "Allow and attach" }).click();
  expect(request).toHaveBeenLastCalledWith({
    op: "attach",
    threadId: capabilitiesLocation.threadId,
    windowId: capabilitiesWindow.id,
    foreground: true,
  });
  const foregroundStep = page.getByText(
    "Agent has control. Bring this window to the front for physical input.",
  );
  const idle = page.getByText("Agent has control", { exact: true });
  await expect.element(idle).toBeVisible();
  await expect.element(foregroundStep).not.toBeInTheDocument();
  expect(request.mock.calls.filter(([input]) => input.op === "status")).toHaveLength(1);

  activity = "checking_foreground";
  await view.rerender(access(true));
  await expect
    .element(page.getByText("Agent is checking if this window is in front"))
    .toBeVisible();
  activity = "foreground";
  await expect.element(page.getByText("Agent used physical input")).toBeVisible();

  activity = "needs_foreground";
  await view.rerender(access(false));
  await expect.element(foregroundStep).toBeVisible();
  await page.getByRole("button", { name: "My turn" }).click();
  await expect.element(page.getByText("You have control")).toBeVisible();
  await expect.element(foregroundStep).not.toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith({
    op: "take",
    threadId: capabilitiesLocation.threadId,
    selector: "window:physical",
  });
  await page.getByRole("button", { name: "Return to agent" }).click();
  await expect.element(idle).toBeVisible();
  await expect.element(foregroundStep).not.toBeInTheDocument();
});

it("ignores status for a different attachment and a pending refresh after keyboard revocation", async () => {
  const location = capabilitiesLocation;
  const grant = {
    window: capabilitiesWindow,
    selector: "window:current",
    mode: "agent",
    foreground: true,
  } as const;
  let resolveStatus!: (state: NativeComputerState) => void;
  const pending = new Promise<NativeComputerState>((resolve) => {
    resolveStatus = resolve;
  });
  const request = vi.fn((_input: NativeComputerCommand) => pending);
  request.mockResolvedValueOnce({ grant });
  request.mockResolvedValueOnce({
    grant: { ...grant, window: { ...grant.window, pid: grant.window.pid + 1 } },
    activity: "needs_foreground",
  });
  const access = (isActivePane: boolean) => (
    <NativeWindowAccess
      enabled
      activeAgentTurn
      isActivePane={isActivePane}
      location={location}
      request={request}
      attachToDraft={vi.fn()}
    />
  );
  const view = await render(access(false));
  const idle = page.getByText("Agent has control", { exact: true });
  await expect.element(idle).toBeVisible();
  expect(request).toHaveBeenCalledExactlyOnceWith({ op: "status", threadId: location.threadId });

  await view.rerender(access(true));
  await expect.poll(() => request.mock.calls.length).toBe(3);
  await expect.element(idle).toBeVisible();
  publish({ location: { ...location, threadId: ThreadId.make("other") }, state: { grant: null } });
  publish({
    location: { ...location, environmentId: EnvironmentId.make("other") },
    state: { grant: null },
  });
  await expect.element(idle).toBeVisible();

  publish({ location, state: { grant: null } });
  const attach = page.getByRole("button", { name: "Attach desktop window" });
  await expect.element(attach).toBeVisible();
  resolveStatus({ grant, activity: "needs_foreground" });
  await view.rerender(access(true));
  await expect.element(attach).toBeVisible();
});

it("updates the window controls after a scoped keyboard takeover or revocation", async () => {
  const threadId = ThreadId.make("window-keyboard");
  const location = { projectId: "test", environmentId: null, threadId };
  let grant: NativeComputerState["grant"] = {
    window: {
      id: "chosen",
      app: "Example",
      title: "Document",
      pid: 107,
      frame: { x: 8, y: 8, width: 800, height: 600 },
    },
    selector: "window:exact",
    mode: "agent",
    foreground: false,
  };
  const request = vi.fn(async (command: NativeComputerCommand): Promise<NativeComputerState> => {
    if (command.op === "take" && grant) grant = { ...grant, mode: "user" };
    if (command.op === "revoke") grant = null;
    return { grant };
  });
  await render(
    <NativeWindowAccess enabled location={location} request={request} attachToDraft={vi.fn()} />,
  );
  await expect.element(page.getByText("Agent has control")).toBeVisible();
  publish({ location: { ...location, projectId: "other" }, state: { grant: null } });
  await expect.element(page.getByText("Agent has control")).toBeVisible();
  await expect(
    runNativeWindowHandoff(request, threadId, "take", "window:stale", () => true),
  ).rejects.toThrow("focused desktop window");
  expect(request.mock.calls.every(([command]) => command.op === "status")).toBe(true);
  publish({
    location,
    state: await runNativeWindowHandoff(request, threadId, "take", "window:exact", () => true),
  });
  await expect.element(page.getByText("You have control")).toBeVisible();
  expect(request).toHaveBeenLastCalledWith({ op: "take", threadId, selector: "window:exact" });
  publish({
    location,
    state: await runNativeWindowHandoff(request, threadId, "revoke", undefined, () => true),
  });
  await expect.element(page.getByRole("button", { name: "Attach desktop window" })).toBeVisible();
  expect(request).toHaveBeenLastCalledWith({ op: "revoke", threadId, selector: "window:exact" });
});

const handoffLocation = {
  projectId: "example",
  environmentId: EnvironmentId.make("native-owner"),
  threadId: ThreadId.make("native-return"),
};
const taken = {
  window: {
    id: "chosen",
    app: "Example",
    title: "Report",
    pid: 107,
    frame: { x: 8, y: 8, width: 800, height: 600 },
  },
  selector: "window:original",
  mode: "user",
  foreground: false,
  takeoverId: "original-takeover",
} as const;
const returned = { ...taken, mode: "agent" } as const;
const verifiedReturn = { grant: returned, continuationId: "verified-native-demo" };

it("leaves the thread idle when returning control provides no verified step", async () => {
  const request = vi.fn(
    async (input: NativeComputerCommand): Promise<NativeComputerState> =>
      input.op === "resume" ? { grant: returned } : { grant: taken },
  );
  await render(
    <NativeWindowAccess
      enabled
      location={handoffLocation}
      request={request}
      attachToDraft={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Return to agent" }).click();
  await expect.element(page.getByText("Agent has control")).toBeVisible();
  expect(environmentApi).not.toHaveBeenCalled();
  expect(dispatchCommand).not.toHaveBeenCalled();
});

it("blocks a continuation when a keyboard revocation supersedes a pending status response", async () => {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("stale-native");
  let resolveStatus!: (state: NativeComputerState) => void;
  const status = new Promise<NativeComputerState>((resolve) => {
    resolveStatus = resolve;
  });
  const verifyStatus = vi.fn(() => status);
  let resumed = false;
  const request = vi.fn(async (input: NativeComputerCommand): Promise<NativeComputerState> => {
    if (input.op === "resume") {
      resumed = true;
      return verifiedReturn;
    }
    if (resumed && input.op === "status") return verifyStatus();
    return { grant: taken };
  });
  await render(
    <NativeWindowAccess
      enabled
      location={handoffLocation}
      request={request}
      attachToDraft={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Return to agent" }).click();
  await vi.waitFor(() => expect(verifyStatus).toHaveBeenCalledOnce());
  publish({ location: handoffLocation, state: { grant: null } });
  resolveStatus({ grant: returned });
  await vi.waitFor(() =>
    expect(add).toHaveBeenCalledWith({
      type: "warning",
      title: "The approved handoff has changed",
    }),
  );
  expect(dispatchCommand).not.toHaveBeenCalled();
});

it("retries the same receipt and blocks it once a newer generation has returned", async () => {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("native-retry");
  dispatchCommand.mockRejectedValueOnce(new Error("Connection dropped"));
  dispatchCommand.mockRejectedValueOnce(new Error("Connection dropped again"));
  let live: NativeComputerState = { grant: taken };
  const request = vi.fn(async (input: NativeComputerCommand): Promise<NativeComputerState> => {
    if (input.op === "resume") {
      live = { grant: returned };
      return verifiedReturn;
    }
    return live;
  });
  await render(
    <NativeWindowAccess
      enabled
      location={handoffLocation}
      request={request}
      attachToDraft={vi.fn()}
    />,
  );
  await page.getByRole("button", { name: "Return to agent" }).click();
  await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  const retry = add.mock.calls[0]?.[0].actionProps?.onClick as (() => void) | undefined;
  expect(retry).toBeTypeOf("function");
  retry?.();
  await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  expect(dispatchCommand).toHaveBeenCalledTimes(2);
  expect(dispatchCommand.mock.calls[0]).toEqual(dispatchCommand.mock.calls[1]);

  live = { grant: { ...returned, takeoverId: "newer-takeover" } };
  retry?.();
  await vi.waitFor(() =>
    expect(add).toHaveBeenLastCalledWith({
      type: "warning",
      title: "The approved handoff has changed",
    }),
  );
  expect(dispatchCommand).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.filter(([input]) => input.op === "resume")).toHaveLength(1);
});
