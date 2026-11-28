import "../../index.css";
import { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { createFakeDeviceApi, fakeDevice, fakeDeviceState } from "~/device/fakeDeviceApi";
import { surfaceScope } from "~/lib/threadSurfaceAttachment";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { LauncherSurface } from "../quick-actions/QuickActions";
import { QUICK_ACTIONS } from "../quick-actions/actions";
import { AttachRunningDeviceDialog } from "./AttachRunningDeviceDialog";

const { resolveEnvironment } = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: resolveEnvironment,
}));

it("attaches the exact running device with Quick Actions and the keyboard", async () => {
  const location = {
    environmentId: EnvironmentId.make("desktop"),
    threadId: ThreadId.make("checkout"),
    projectId: "project",
  };
  const labThread = ThreadId.make("lab");
  const personalThread = ThreadId.make("personal");
  const otherProject = ThreadId.make("other-project");
  const devices = ["lab-host", "personal-host", "other-host"].map((hostId) =>
    fakeDevice({
      hostId,
      id: "emulator-5554",
      name: "Pixel",
      platform: "android",
    }),
  );
  const sessions = [labThread, personalThread, otherProject].map((threadId, index) => ({
    threadId,
    hostId: devices[index]!.hostId,
    deviceId: devices[index]!.id,
    platform: devices[index]!.platform,
    openedAt: "2026-01-01T00:00:00.000Z",
  }));
  const fake = createFakeDeviceApi(fakeDeviceState({ devices, sessions }));
  resolveEnvironment.mockResolvedValue({ device: fake.api });
  const scope = surfaceScope(location);
  const draftKey = scopedComposerThreadId(location.environmentId, location.threadId);
  const initialDrafts = useComposerDraftStore.getState().draftsByThreadId;
  const initialSurfaces = useCompanionSurfaceStore.getState().workspaces;
  const existing = useCompanionSurfaceStore.getState().open(scope, "browser", { title: "Work" });
  const threads = new Map([
    [labThread, "Lab checkout"],
    [personalThread, "Other checkout"],
  ]);

  function Harness() {
    const [open, setOpen] = useState(false);
    return open ? (
      <AttachRunningDeviceDialog
        location={location}
        threads={threads}
        isCurrent={() => true}
        onClose={() => setOpen(false)}
      />
    ) : (
      <LauncherSurface
        design="compass"
        actions={QUICK_ACTIONS}
        execute={async (id) => {
          if (id === "attach-running-device") setOpen(true);
        }}
        disabled={() => undefined}
        preview
      />
    );
  }

  const view = await render(<Harness />);
  try {
    (page.getByRole("button", { name: "More actions" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const action = page.getByRole("button", {
      name: "Attach a running device",
      exact: true,
    });
    await expect.element(action).toBeVisible();
    (action.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    const dialog = page.getByRole("dialog", {
      name: "Attach a running device",
    });
    await expect.element(dialog).toBeVisible();
    const lab = dialog.getByRole("button", {
      name: /Pixel lab-host · emulator-5554 Lab checkout/,
    });
    await expect.element(lab).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: /personal-host/ })).toBeVisible();
    await expect
      .element(dialog.getByRole("button", { name: /other-host/ }))
      .not.toBeInTheDocument();
    expect(fake.calls).toEqual([{ method: "list", input: { inspectOnly: true } }]);
    (lab.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");

    await expect.element(dialog).not.toBeInTheDocument();
    expect(fake.calls.at(-1)).toEqual({
      method: "open",
      input: {
        threadId: location.threadId,
        fromThreadId: labThread,
        hostId: "lab-host",
        deviceId: "emulator-5554",
        platform: "android",
        boot: false,
      },
    });
    const [attachment] = useComposerDraftStore.getState().draftsByThreadId[draftKey]!.files;
    expect(JSON.parse(await attachment!.file!.text())).toMatchObject({
      threadId: location.threadId,
      target: { kind: "device", hostId: "lab-host", deviceId: "emulator-5554" },
    });
    const workspace = useCompanionSurfaceStore.getState().workspaces[scope]!;
    expect(workspace.activeId).toBe(existing);
    expect(workspace.tabs).toHaveLength(2);
  } finally {
    await view.unmount();
    resolveEnvironment.mockReset();
    useCompanionSurfaceStore.setState({ workspaces: initialSurfaces });
    useComposerDraftStore.setState({ draftsByThreadId: initialDrafts });
  }
});
