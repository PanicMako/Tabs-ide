import "../../index.css";
import {
  DeviceComparisonError,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DesktopBrowserAutomationInput,
  type DeviceComparisonReport,
  type DeviceComparisonStatus,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { emptyBrowserState } from "~/components/agents/companion/browserSession";
import { GlobalConfirmDialog } from "~/components/GlobalConfirmDialog";
import { acceptDeviceState } from "~/device/deviceStore";
import {
  createFakeDeviceApi,
  createFakeMjpegStream,
  fakeDevice,
  fakeDeviceJpeg,
  fakeDeviceState,
  fakeIosMjpegUrl,
} from "~/device/fakeDeviceApi";
import { AppAtomRegistryProvider, appAtomRegistry } from "~/state/atomRegistry";
import { readModelStateAtom } from "~/state/readModel";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import type { Thread } from "~/types";

import { CompanionDevicePanel } from "./DevicePanel";

const fake = createFakeDeviceApi();
vi.mock("~/device/useDeviceApi", () => ({ useDeviceApi: () => fake.api }));
const { dispatchCommand, continuationEnvironment } = vi.hoisted(() => ({
  dispatchCommand: vi.fn(async (_command: unknown) => ({})),
  continuationEnvironment: vi.fn((_environmentId: unknown) => {}),
}));
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: async (environmentId: unknown) => {
    continuationEnvironment(environmentId);
    return { orchestration: { dispatchCommand } };
  },
}));

const threadId = ThreadId.make("checkout");
const runId = "e2da1c6e-652c-4c7f-bb19-4f6db92ab47b";
const controlId = "a7c5c595-73f9-4f0c-8ee1-e6fe88035e88";
const source = {
  hostId: "mac-host",
  deviceId: "phone",
  platform: "ios" as const,
  appId: "com.tabs.ios",
  name: "iPhone 16",
};
const target = {
  hostId: "android-host",
  deviceId: "phone",
  platform: "android" as const,
  appId: "com.tabs.android",
  name: "Pixel",
};
const smallPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNioAAAAASUVORK5CYII=";

async function mockComparisonDeviceMedia(
  hubBasePath: string,
  device: typeof source | typeof target,
  width: number,
  height: number,
) {
  const originalFetch = globalThis.fetch;
  let url: string;
  let respond: () => Response;
  if (device.platform === "ios") {
    const stream = createFakeMjpegStream();
    stream.writeFrame(await fakeDeviceJpeg(width, height));
    url = fakeIosMjpegUrl(hubBasePath, device.hostId, device.deviceId);
    respond = () => stream.response;
  } else {
    const screenshot = new URL(
      `${hubBasePath}/vendor/serve-emu/api/screenshot`,
      window.location.origin,
    );
    screenshot.searchParams.set("device", device.deviceId);
    screenshot.searchParams.set("hostId", device.hostId);
    url = screenshot.href;
    const png = Uint8Array.from(atob(smallPng), (value) => value.charCodeAt(0));
    respond = () => new Response(png, { headers: { "Content-Type": "image/png" } });
  }
  const authorizeMediaUrl = fake.api.authorizeMediaUrl;
  fake.api.authorizeMediaUrl = (candidate) =>
    candidate === url ? Promise.resolve(candidate) : new Promise(() => {});
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, options) =>
      (input instanceof Request ? input.url : String(input)) === url
        ? Promise.resolve(respond())
        : originalFetch(input, options),
    );
  return () => {
    fetch.mockRestore();
    if (authorizeMediaUrl) fake.api.authorizeMediaUrl = authorizeMediaUrl;
    else delete fake.api.authorizeMediaUrl;
  };
}

it.each([
  "approved",
  "lost reply",
  "lost status",
  "reconnected after commit",
  "user retry",
  "rejected",
  "changed page",
  "left review during authorization",
] as const)(
  "binds the initial comparison and draft review to the exact desktop tab (%s)",
  async (outcome) => {
    dispatchCommand.mockClear();
    const environmentId = EnvironmentId.make("primary");
    const projectId = ProjectId.make("checkout-project");
    const instanceId = crypto.randomUUID();
    const grantIds = [crypto.randomUUID(), crypto.randomUUID()];
    const tabId = "agents-surface-work-draft";
    const profileId = "work";
    const pageRef = "a".repeat(64);
    const pageApprovalToken = "reviewed-draft";
    const url = "https://quality.test/draft/existing";
    const state = appAtomRegistry.get(readModelStateAtom);
    appAtomRegistry.set(readModelStateAtom, {
      ...state,
      threads: [{ id: threadId, projectId, environmentId } as Thread],
    });
    const getBrowserSessionState = vi.fn(async () => ({
      ...emptyBrowserState(projectId, tabId),
      instanceId,
      profileId,
      pageRef: outcome === "changed page" ? "b".repeat(64) : pageRef,
      pageApprovalToken,
      currentUrl: url,
      pageTitle: "Guest checkout QA checklist",
      browserPageAuthorized: true,
      assignedTaskId: threadId,
    }));
    const runBrowserAutomation = vi.fn(async (_input: DesktopBrowserAutomationInput) => ({
      grantIds,
    }));
    const previousBridge = window.desktopBridge;
    window.desktopBridge = {
      getBrowserSessionState,
      runBrowserAutomation,
    } as unknown as NonNullable<Window["desktopBridge"]>;
    let run: DeviceComparisonReport = {
      runId,
      phase: "awaiting_approval",
      source,
      target,
      agentRecording: {
        manual: false,
        evidenceDestination: { tabId, profileId, pageRef, instanceId },
      },
      busy: false,
      playing: false,
      completedSteps: 0,
      steps: [],
      canResume: false,
      uncertainTap: false,
    };
    let approvalCalls = 0;
    let blockedStatusReads = 0;
    let blockedAllStatusReads = false;
    const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
      if (input.action === "approveAgentRecording") {
        approvalCalls++;
        if (outcome === "rejected")
          throw new DeviceComparisonError({
            reason: "The device attachments changed.",
          });
        if (outcome === "user retry" && approvalCalls <= 2) {
          blockedStatusReads++;
          throw new Error("Could not deliver approval.");
        }
        run = {
          ...run,
          phase: "recording",
          approvalId: input.approvalRequestId ?? controlId,
        };
        if (outcome === "lost reply") throw new Error("Connection reset after approval.");
        if (outcome === "lost status" && approvalCalls === 1) {
          blockedStatusReads++;
          throw new Error("Connection reset after approval.");
        }
        if (outcome === "reconnected after commit") {
          blockedAllStatusReads = true;
          throw new Error("Connection reset after approval.");
        }
      }
      if (input.action === "status") {
        if (blockedAllStatusReads) throw new Error("Status unavailable.");
        if (input.runId === runId && blockedStatusReads > 0) {
          blockedStatusReads--;
          throw new Error("Status unavailable.");
        }
      }
      return { run };
    });
    fake.api.comparison = calls;
    acceptDeviceState(
      fakeDeviceState({
        agentAccessEnabled: true,
        devices: [source, target].map((device) =>
          fakeDevice({ ...device, id: device.deviceId, booted: true }),
        ),
        sessions: [source, target].map((device) => ({
          ...device,
          threadId,
          openedAt: "now",
        })),
      }),
    );
    try {
      const view = await render(
        <AppAtomRegistryProvider>
          <CompanionDevicePanel
            surface={{
              ...source,
              id: "source-tab",
              kind: "device",
              title: source.name,
            }}
            scope="checkout"
            threadId={threadId}
            environmentId={environmentId}
          />
        </AppAtomRegistryProvider>,
      );
      const combined = page.getByRole("button", {
        name: "Approve",
        exact: true,
      });
      await expect.poll(() => getBrowserSessionState.mock.calls.length).toBeGreaterThan(0);
      if (outcome === "changed page") {
        await expect
          .element(page.getByRole("button", { name: "Approve devices only" }))
          .not.toBeInTheDocument();
        await combined.click();
        expect(calls).toHaveBeenCalledWith({
          action: "approveAgentRecording",
          runId,
          threadId,
        });
        expect(runBrowserAutomation).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
        return;
      }
      await expect
        .element(page.getByRole("definition").filter({ hasText: "Guest checkout QA checklist" }))
        .toBeVisible();
      await expect.element(page.getByText(`${url} · ${profileId}`)).toBeVisible();
      expect(runBrowserAutomation).not.toHaveBeenCalled();
      const browserArgs = {
        projectId,
        sessionId: tabId,
        taskId: threadId,
        source: "human",
      };
      if (outcome === "left review during authorization") {
        let finishAuthorization!: () => void;
        runBrowserAutomation.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishAuthorization = () => resolve({ grantIds });
            }),
        );
        await combined.click();
        expect(runBrowserAutomation).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            ...browserArgs,
            operation: "authorizeDeviceComparisonEvidence",
          }),
        );
        await view.unmount();
        finishAuthorization();
        await vi.waitFor(() =>
          expect(runBrowserAutomation).toHaveBeenNthCalledWith(2, {
            ...browserArgs,
            operation: "revokeDeviceScreenshot",
            input: { grantIds },
          }),
        );
        expect(approvalCalls).toBe(0);
        expect(dispatchCommand).not.toHaveBeenCalled();
        return;
      }
      await combined.click();
      expect(runBrowserAutomation).toHaveBeenNthCalledWith(1, {
        ...browserArgs,
        operation: "authorizeDeviceComparisonEvidence",
        input: {
          url,
          instanceId,
          profileId,
          pageRef,
          pageApprovalToken,
          runId,
          source: { hostId: source.hostId, deviceId: source.deviceId },
          target: { hostId: target.hostId, deviceId: target.deviceId },
        },
      });
      expect(calls).toHaveBeenCalledWith({
        action: "approveAgentRecording",
        runId,
        threadId,
        evidence: { tabId, grantIds },
        approvalRequestId: expect.any(String),
      });
      if (outcome === "user retry" || outcome === "reconnected after commit") {
        const retry = page.getByRole("button", { name: "Send approval again" });
        await expect.element(retry).toBeVisible();
        expect(runBrowserAutomation).toHaveBeenCalledTimes(1);
        expect(dispatchCommand).not.toHaveBeenCalled();
        if (outcome === "user retry") {
          await expect
            .element(page.getByRole("button", { name: "Approve devices only" }))
            .toBeDisabled();
          await retry.click();
        } else {
          blockedAllStatusReads = false;
        }
      }
      const requests = calls.mock.calls
        .map(([input]) => input)
        .filter((input) => input.action === "approveAgentRecording");
      expect(new Set(requests.map((input) => input.approvalRequestId)).size).toBe(1);
      expect(
        requests.every(
          (input) => JSON.stringify(input.evidence?.grantIds) === JSON.stringify(grantIds),
        ),
      ).toBe(true);
      if (outcome === "rejected") {
        await expect.element(page.getByText("The device attachments changed.")).toBeVisible();
        expect(runBrowserAutomation).toHaveBeenNthCalledWith(2, {
          ...browserArgs,
          operation: "revokeDeviceScreenshot",
          input: { grantIds },
        });
        expect(dispatchCommand).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() =>
          expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              commandId: run.approvalId,
              text: expect.stringContaining(
                "I also approved attaching both first-difference screenshots",
              ),
            }),
          ),
        );
        expect(runBrowserAutomation).toHaveBeenCalledTimes(1);
      }
    } finally {
      appAtomRegistry.set(readModelStateAtom, state);
      if (previousBridge) window.desktopBridge = previousBridge;
      else delete window.desktopBridge;
    }
  },
);

it.each([true, false])("reviews the exact pair before approval (%s)", async (approve) => {
  dispatchCommand.mockClear();
  continuationEnvironment.mockClear();
  const approvalId = "b9490553-2ed8-4820-9736-f4c1733db16d";
  let run: DeviceComparisonReport = {
    runId,
    phase: "awaiting_approval",
    source,
    target,
    agentRecording: {
      manual: false,
      ...(approve && {
        total: {
          sourceLabel: "Total",
          targetLabel: "Order total",
          currency: "USD",
        },
      }),
    },
    busy: false,
    playing: false,
    completedSteps: 0,
    steps: [],
    canResume: false,
    uncertainTap: false,
  };
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    if (input.action === "approveAgentRecording") run = { ...run, phase: "recording", approvalId };
    if (input.action === "stop") run = { ...run, phase: "stopped" };
    if (input.action === "takeover" || input.action === "resume") {
      const manual = input.action === "takeover";
      run = {
        ...run,
        canResume: manual,
        agentRecording: { ...run.agentRecording, manual },
      };
    }
    return {
      run,
      ...(run.phase === "recording" ? { ownerThreadId: threadId } : {}),
      ...(run.agentRecording?.manual ? { manualControlId: controlId } : {}),
    };
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      agentAccessEnabled: true,
      devices: [source, target].map((device) =>
        fakeDevice({ ...device, id: device.deviceId, booted: true }),
      ),
      sessions: [source, target].map((device) => ({
        ...device,
        threadId,
        openedAt: "now",
      })),
    }),
  );
  await render(
    <CompanionDevicePanel
      surface={{
        ...source,
        id: "source-tab",
        kind: "device",
        title: source.name,
      }}
      scope="checkout"
      threadId={threadId}
      environmentId="test-remote"
    />,
  );
  const grant = page.getByRole("region", { name: "Device comparison" });
  await expect.element(grant.getByText("com.tabs.ios", { exact: true })).toBeVisible();
  await expect.element(grant.getByText("com.tabs.android", { exact: true })).toBeVisible();
  await expect
    .element(
      grant.getByText(
        approve
          ? /^Use com\.tabs\.ios on iPhone 16 and com\.tabs\.android on Pixel.*, and pause if totals differ\.$/
          : /^Use com\.tabs\.ios on iPhone 16 and com\.tabs\.android on Pixel[^,]*\.$/,
      ),
    )
    .toBeVisible();
  if (approve) {
    await expect
      .element(grant.getByText(/“Total” on iPhone 16 with “Order total” on Pixel/))
      .toBeVisible();
    await expect
      .element(grant.getByText("No total check — totals won't be compared."))
      .not.toBeInTheDocument();
  } else {
    await expect
      .element(grant.getByText("No total check — totals won't be compared."))
      .toBeVisible();
  }
  expect(dispatchCommand).not.toHaveBeenCalled();
  expect(calls.mock.calls.every(([input]) => input.action === "status")).toBe(true);

  await grant
    .getByRole("button", approve ? { name: "Approve", exact: true } : { name: "Decline" })
    .click();
  expect(calls).toHaveBeenCalledWith({
    action: approve ? "approveAgentRecording" : "stop",
    threadId,
    runId,
  });
  if (approve) {
    await expect.element(grant.getByText("This thread is recording on iPhone 16.")).toBeVisible();
    await expect
      .element(grant.getByRole("button", { name: "Demonstrate tap" }))
      .not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: "message.dispatch",
          commandId: approvalId,
          messageId: approvalId,
          threadId,
          text: expect.stringContaining(runId),
          dispatchMode: { type: "queue_after_active" },
        }),
      ),
    );
    expect(continuationEnvironment).toHaveBeenCalledWith("test-remote");

    await grant.getByRole("button", { name: "My turn" }).click();
    await expect.element(grant.getByText("Your turn on the recording device.")).toBeVisible();
    expect(calls).toHaveBeenCalledWith({
      action: "takeover",
      threadId,
      runId,
      liveInput: true,
      device: { hostId: source.hostId, deviceId: source.deviceId },
    });
    await grant.getByRole("button", { name: "Return to agent" }).click();
    expect(calls).toHaveBeenCalledWith({
      action: "resume",
      threadId,
      runId,
      controlId,
    });
    await vi.waitFor(() =>
      expect(dispatchCommand).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          commandId: controlId,
          messageId: controlId,
          threadId,
          text: expect.stringContaining("continue from here"),
        }),
      ),
    );
  } else {
    await expect
      .element(grant.getByRole("button", { name: "Start new demonstration" }))
      .toBeVisible();
    expect(dispatchCommand).not.toHaveBeenCalled();
  }
});

it.each([
  { from: source, to: target },
  { from: target, to: source },
])(
  "uses the $to.platform screen and waits for input before returning control",
  async ({ from, to }) => {
    let manual = false;
    let phase: DeviceComparisonReport["phase"] = "paused";
    let acknowledgeTap: () => void = () => {};
    const tapAck = new Promise<void>((resolve) => {
      acknowledgeTap = resolve;
    });
    const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
      if (input.action === "takeover") manual = true;
      if (input.action === "manualInput" && input.gesture.type === "tap") await tapAck;
      if (input.action === "resume") {
        manual = false;
        phase = "running";
      }
      return {
        ownerThreadId: threadId,
        ...(manual ? { manualControlId: controlId } : {}),
        run: {
          runId,
          phase,
          source: from,
          target: to,
          busy: false,
          playing: phase === "running",
          completedSteps: 0,
          steps: [{ label: "Continue" }],
          totalVerification: {
            startsAt: { step: 1, timing: "after" },
            pending: { step: 1, timing: "after" },
          },
          canResume: phase === "paused",
          uncertainTap: false,
        },
      };
    });
    fake.api.comparison = calls;
    const state = fakeDeviceState({
      hubBasePath: "/api/device-hub",
      agentAccessEnabled: true,
      devices: [fakeDevice({ ...to, id: to.deviceId, booted: true })],
      sessions: [{ ...to, threadId, openedAt: "now" }],
    });
    const restoreMedia = await mockComparisonDeviceMedia(state.hubBasePath, to, 1, 1);
    acceptDeviceState(state);
    const view = await render(
      <div style={{ width: 390 }}>
        <CompanionDevicePanel
          surface={{ ...to, id: "device-tab", kind: "device", title: to.name }}
          scope="checkout"
          threadId={threadId}
        />
      </div>,
    );
    try {
      const screen = page.getByRole("application", { name: "Device screen" });
      await expect.element(screen).toHaveAttribute("aria-disabled", "true");
      await page.getByRole("button", { name: "My turn" }).click();
      await expect.element(screen).toHaveAttribute("aria-disabled", "false");
      if (to.platform === "ios") {
        await expect.element(page.getByRole("button", { name: "Rotate" })).toBeDisabled();
      }
      await expect.poll(() => view.container.querySelector("img")?.naturalWidth).toBe(1);
      await screen.click();
      await expect
        .poll(() => calls.mock.calls.find(([input]) => input.action === "manualInput")?.[0])
        .toMatchObject({
          action: "manualInput",
          runId,
          threadId,
          controlId,
          gesture: { type: "tap", viewport: { width: 1, height: 1 } },
        });
      await userEvent.keyboard("ab");
      const resume = page.getByRole("button", {
        name: "I did this step — resume",
      });
      await expect
        .element(page.getByText(/Resume will recheck the total after step 1/))
        .toBeVisible();
      await expect.element(resume).toBeDisabled();
      acknowledgeTap();
      await expect.element(resume).toBeEnabled();
      expect(
        calls.mock.calls.flatMap(([input]) =>
          input.action === "manualInput" && input.gesture.type === "text"
            ? [input.gesture.text]
            : [],
        ),
      ).toEqual(["a", "b"]);
      await resume.click();
      expect(calls).toHaveBeenCalledWith({
        action: "resume",
        runId,
        threadId,
        stepCompleted: true,
        controlId,
      });
      await expect.element(screen).toHaveAttribute("aria-disabled", "true");
    } finally {
      acknowledgeTap();
      await view.unmount();
      restoreMedia();
    }
  },
);

it("retries the original continuation from the destination after replay completes", async () => {
  const run: DeviceComparisonReport = {
    runId,
    phase: "completed",
    source,
    target,
    agentRecording: { manual: false },
    busy: false,
    playing: false,
    completedSteps: 1,
    steps: [{ label: "Continue" }],
    canResume: false,
    uncertainTap: false,
  };
  let pending = true;
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    if (input.action === "resume") pending = false;
    return {
      run,
      ...(pending && {
        pendingReplayReturn: { controlId, stepCompleted: true },
      }),
    };
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [fakeDevice({ ...target, id: target.deviceId, booted: true })],
      sessions: [{ ...target, threadId, openedAt: "now" }],
    }),
  );
  const view = await render(
    <div style={{ width: 340 }}>
      <CompanionDevicePanel
        surface={{ ...target, id: "pixel-tab", kind: "device", title: "Pixel" }}
        scope="checkout"
        threadId={threadId}
      />
    </div>,
  );
  try {
    const retry = page.getByRole("button", { name: "Tell the agent again" });
    await expect.element(retry).toBeVisible();
    await retry.click();
    expect(calls).toHaveBeenCalledWith({
      action: "resume",
      threadId,
      runId,
      controlId,
      stepCompleted: true,
    });
    await expect.element(retry).not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("shows the first diverging screens and sends keyboard correction, resume and stop through the Device panel", async () => {
  const initial: DeviceComparisonReport = {
    runId,
    phase: "running",
    source,
    target,
    busy: true,
    playing: true,
    completedSteps: 0,
    steps: [{ label: "Continue" }],
    totalVerification: { startsAt: { step: 1, timing: "after" } },
    canResume: false,
    uncertainTap: false,
  };
  let run = initial;
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    switch (input.action) {
      case "takeover":
        run = {
          ...initial,
          phase: "paused",
          busy: false,
          playing: false,
          canResume: true,
          pauseReason: "You have control.",
          firstDifference: {
            step: 1,
            kind: "control",
            reason: "Continue is unavailable.",
          },
        };
        break;
      case "resume":
        run = initial;
        break;
      case "stop":
        run = {
          ...initial,
          phase: "stopped",
          busy: false,
          playing: false,
          pauseReason: "Comparison stopped.",
        };
        break;
    }
    const status: DeviceComparisonStatus = {
      run,
      ...(run.phase === "stopped" ? {} : { ownerThreadId: threadId }),
      ...(run.phase === "paused"
        ? {
            controls: [{ id: controlId, label: "Allow", role: "button", canTap: true }],
          }
        : {}),
      ...(input.action === "evidence"
        ? { evidence: { sourcePng: smallPng, targetPng: smallPng } }
        : {}),
    };
    return status;
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [source, target].map((device) =>
        fakeDevice({ ...device, id: device.deviceId, booted: true }),
      ),
      sessions: [source, target].map((device) => ({
        ...device,
        threadId,
        openedAt: "now",
      })),
    }),
  );
  await render(
    <div style={{ width: 340 }}>
      <CompanionDevicePanel
        surface={{ ...target, id: "pixel-tab", kind: "device", title: "Pixel" }}
        scope="checkout"
        threadId={threadId}
      />
    </div>,
  );
  const myTurn = page.getByRole("button", { name: "My turn" });
  await expect.element(page.getByText(/Total verification starts after step 1/)).toBeVisible();
  await expect.element(myTurn).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Home", exact: true })).toBeDisabled();
  (myTurn.element() as HTMLButtonElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("img", { name: "iPhone 16 at the first difference" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("img", { name: "Pixel at the first difference" }))
    .toBeVisible();
  await page.getByRole("combobox", { name: "Accessible control" }).selectOptions("Allow");
  await page.getByRole("button", { name: "Apply correction" }).click();
  expect(calls).toHaveBeenCalledWith({
    action: "tap",
    threadId,
    runId,
    controlId,
  });
  const resume = page.getByRole("button", { name: "Resume replay" });
  (resume.element() as HTMLButtonElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(calls).toHaveBeenCalledWith({ action: "resume", threadId, runId });
  (page.getByRole("button", { name: "Stop comparison" }).element() as HTMLButtonElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("Comparison stopped.")).toBeVisible();
});

it("allows My turn on the exact replay device while first-difference evidence is pending", async () => {
  let run: DeviceComparisonReport = {
    runId,
    phase: "paused",
    source,
    target,
    busy: true,
    playing: true,
    completedSteps: 0,
    steps: [{ label: "Continue" }],
    canResume: false,
    uncertainTap: false,
    firstDifference: {
      step: 1,
      kind: "control",
      reason: "Continue is unavailable.",
    },
  };
  let manual = false;
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    if (input.action === "takeover") {
      manual = true;
      run = { ...run, playing: false };
    }
    return {
      run,
      ownerThreadId: threadId,
      ...(manual
        ? { manualControlId: controlId }
        : {
            controls: [{ id: controlId, label: "Allow", role: "button", canTap: true }],
          }),
      ...(input.action === "evidence"
        ? { evidence: { sourcePng: smallPng, targetPng: smallPng } }
        : {}),
    };
  });
  const comparison = fake.api.comparison;
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [source, target].map((device) =>
        fakeDevice({ ...device, id: device.deviceId, booted: true }),
      ),
      sessions: [source, target].map((device) => ({
        ...device,
        threadId,
        openedAt: "now",
      })),
    }),
  );
  const view = await render(
    <div style={{ width: 340 }}>
      <CompanionDevicePanel
        surface={{
          ...target,
          id: "pixel-tab",
          kind: "device",
          title: target.name,
        }}
        scope="checkout"
        threadId={threadId}
      />
    </div>,
  );
  try {
    const panel = page.getByRole("region", { name: "Device comparison" });
    const evidence = panel.getByRole("region", { name: "First difference" });
    const myTurn = panel.getByRole("button", { name: "My turn" });
    const resume = panel.getByRole("button", { name: "Resume replay" });
    const screen = page.getByRole("application", { name: "Device screen" });
    await expect.element(evidence.getByText("First difference · Step 1 · Continue")).toBeVisible();
    await expect.element(evidence.getByText("Continue is unavailable.")).toBeVisible();
    await expect
      .element(panel.getByRole("combobox", { name: "Accessible control" }))
      .toBeDisabled();
    await expect.element(panel.getByRole("button", { name: "Apply correction" })).toBeDisabled();
    await expect.element(resume).toBeDisabled();
    await expect.element(screen).toHaveAttribute("aria-disabled", "true");
    await expect.element(myTurn).toBeEnabled();

    await myTurn.click();
    expect(calls.mock.calls.filter(([input]) => input.action === "takeover")).toEqual([
      [
        {
          action: "takeover",
          threadId,
          runId,
          liveInput: true,
          device: { hostId: target.hostId, deviceId: target.deviceId },
        },
      ],
    ]);
    await expect.element(myTurn).not.toBeInTheDocument();
    await expect.element(screen).toHaveAttribute("aria-disabled", "true");
    await expect.element(resume).toBeDisabled();

    run = { ...run, busy: false, canResume: true };
    await expect.element(resume).toBeEnabled();
    await expect.element(screen).toHaveAttribute("aria-disabled", "false");
    for (const device of [source, target]) {
      await expect
        .element(
          evidence.getByRole("img", {
            name: `${device.name} at the first difference`,
          }),
        )
        .toBeVisible();
    }
  } finally {
    await view.unmount();
    fake.api.comparison = comparison;
  }
});

it.each(["confirmed", "disconnected", "denied", "before first difference"] as const)(
  "confirms the exact destination before restoring a paused replay (%s)",
  async (outcome) => {
    const beforeDifference = outcome === "before first difference";
    let run: DeviceComparisonReport = {
      runId,
      phase: "stopped",
      savedAt: "2026-11-25T01:00:00.000Z",
      source,
      target,
      busy: false,
      playing: false,
      completedSteps: beforeDifference ? 1 : 0,
      steps: beforeDifference
        ? [{ label: "Open cart" }, { label: "Continue" }]
        : [{ label: "Continue" }],
      ...(!beforeDifference && {
        firstDifference: {
          step: 1,
          kind: "total",
          reason: "Checkout totals differ.",
        },
      }),
      canResume: false,
      uncertainTap: false,
    };
    let attempts = 0;
    const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
      if (input.action === "restoreReplay") {
        attempts++;
        if (outcome === "disconnected" && attempts === 1) throw new Error("Connection reset.");
        if (outcome === "denied")
          throw new DeviceComparisonError({
            reason: "The original device attachments changed.",
          });
        const { savedAt: _savedAt, ...restored } = run;
        run = { ...restored, phase: "paused", canResume: true };
      }
      return { run, ...(run.savedAt && { canRestoreReplay: true as const }) };
    });
    fake.api.comparison = calls;
    acceptDeviceState(
      fakeDeviceState({
        hubBasePath: "",
        agentAccessEnabled: true,
        devices: [source, target].map((device) =>
          fakeDevice({ ...device, id: device.deviceId, booted: true }),
        ),
        sessions: [source, target].map((device) => ({
          ...device,
          threadId,
          openedAt: "now",
        })),
      }),
    );
    const view = await render(
      <>
        <GlobalConfirmDialog />
        <CompanionDevicePanel
          surface={{
            ...target,
            id: "pixel-tab",
            kind: "device",
            title: "Pixel",
          }}
          scope="restore-checkout"
          threadId={threadId}
        />
      </>,
    );
    try {
      const restore = page.getByRole("button", {
        name: "Restore paused replay",
      });
      const confirm = page.getByRole("dialog", { name: "Confirm" });
      await restore.click();
      await expect.element(confirm.getByText(/com.tabs.android on Pixel\?/)).toBeVisible();
      await confirm.getByRole("button", { name: "Cancel" }).click();
      expect(calls.mock.calls.some(([input]) => input.action === "restoreReplay")).toBe(false);
      await restore.click();
      await confirm.getByRole("button", { name: "Confirm" }).click();
      if (outcome === "denied") {
        await expect
          .element(page.getByRole("alert"))
          .toHaveTextContent("The original device attachments changed.");
      } else {
        await expect.element(page.getByRole("button", { name: "Resume replay" })).toBeVisible();
      }
      expect(calls).toHaveBeenCalledWith({
        action: "restoreReplay",
        runId,
        threadId,
        appId: target.appId,
        device: { hostId: target.hostId, deviceId: target.deviceId },
      });
      expect(attempts).toBe(outcome === "disconnected" ? 2 : 1);
      expect(calls.mock.calls.some(([input]) => input.action === "resume")).toBe(false);
      if (beforeDifference) {
        expect(calls.mock.calls.some(([input]) => input.action === "evidence")).toBe(false);
      }
    } finally {
      await view.unmount();
    }
  },
);

it("recovers the original comparison in an empty Device tab and starts fresh only on user request", async () => {
  const saved: DeviceComparisonReport = {
    runId,
    phase: "stopped",
    savedAt: "2026-11-25T01:00:00.000Z",
    source,
    target,
    busy: false,
    playing: false,
    completedSteps: 1,
    steps: [{ label: "Open cart" }, { label: "Continue", expected: "Checkout summary" }],
    firstDifference: {
      step: 2,
      kind: "total",
      reason: "Checkout totals differ.",
      sourceTotal: "$12.00",
      targetTotal: "$13.00",
    },
    canResume: false,
    uncertainTap: false,
  };
  const freshDevice = fakeDevice({
    id: source.deviceId,
    name: source.name,
    booted: true,
  });
  let run = saved;
  const calls = vi.fn<typeof fake.api.comparison>(async (request) => {
    if (request.threadId !== threadId) return {};
    if (request.action === "evidence") {
      return { evidence: { sourcePng: smallPng, targetPng: smallPng } };
    }
    if (request.action === "start") {
      run = {
        runId: controlId,
        phase: "recording",
        source: { ...source, ...request.device, appId: request.appId },
        busy: false,
        playing: false,
        completedSteps: 0,
        steps: [],
        canResume: false,
        uncertainTap: false,
      };
    }
    return { run };
  });
  fake.api.comparison = calls;
  fake.calls.length = 0;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [freshDevice],
      sessions: [],
    }),
  );
  const scope = "saved-comparison-test";
  const store = useCompanionSurfaceStore.getState();
  const tabId = store.open(scope, "device");
  function TestPanel({ activeThread }: { activeThread: ThreadId }) {
    const surface = useCompanionSurfaceStore((state) => state.workspaces[scope]?.tabs[0]);
    return surface ? (
      <div style={{ width: 340 }}>
        <CompanionDevicePanel surface={surface} scope={scope} threadId={activeThread} />
      </div>
    ) : null;
  }
  const view = await render(<TestPanel activeThread={threadId} />);
  try {
    const savedPanel = page.getByRole("region", {
      name: "Saved device comparison",
    });
    const difference = savedPanel.getByRole("region", {
      name: "First difference",
    });
    await expect.element(savedPanel.getByText("Recovered after restart")).toBeVisible();
    await expect
      .element(difference.getByText("First difference · Step 2 · Continue"))
      .toBeVisible();
    await expect.element(difference.getByText("Checkout totals differ.")).toBeVisible();
    const [sourceFigure, targetFigure] = difference.getByRole("figure").elements();
    expect(sourceFigure).toHaveTextContent("iPhone 16");
    expect(sourceFigure).toHaveTextContent("com.tabs.ios");
    expect(sourceFigure).toHaveTextContent("$12.00");
    expect(targetFigure).toHaveTextContent("Pixel");
    expect(targetFigure).toHaveTextContent("com.tabs.android");
    expect(targetFigure).toHaveTextContent("$13.00");
    expect(sourceFigure!.getBoundingClientRect().right).toBeLessThan(
      targetFigure!.getBoundingClientRect().left,
    );
    for (const device of [source, target]) {
      await expect
        .element(
          difference.getByRole("img", {
            name: `${device.name} at the first difference`,
          }),
        )
        .toBeVisible();
    }
    await savedPanel.getByText("Recorded steps").click();
    await expect.element(savedPanel.getByText("Open cart")).toBeVisible();
    await expect.element(savedPanel.getByText("Continue · Expect Checkout summary")).toBeVisible();
    expect(calls.mock.calls[0]).toEqual([{ action: "status", threadId }]);
    expect(calls).toHaveBeenCalledWith({ action: "evidence", threadId, runId });
    expect(calls.mock.calls.every(([input]) => ["status", "evidence"].includes(input.action))).toBe(
      true,
    );
    expect(fake.calls).toEqual([]);
    expect(savedPanel.getByRole("button").elements()).toHaveLength(0);
    expect(page.getByRole("application", { name: "Device screen" }).elements()).toHaveLength(0);

    const otherThread = ThreadId.make("another-checkout");
    await view.rerender(<TestPanel activeThread={otherThread} />);
    await expect
      .poll(() => calls.mock.calls.some(([input]) => input.threadId === otherThread))
      .toBe(true);
    await expect.element(savedPanel).not.toBeInTheDocument();

    await view.rerender(<TestPanel activeThread={threadId} />);
    await expect.element(savedPanel).toBeVisible();
    await page.getByRole("button", { name: "Open iPhone 16" }).click();
    expect(fake.calls).toEqual([
      {
        method: "open",
        input: {
          threadId,
          hostId: freshDevice.hostId,
          deviceId: freshDevice.id,
          platform: freshDevice.platform,
        },
      },
    ]);
    const start = savedPanel.getByRole("button", {
      name: "Start new demonstration",
    });
    await expect.element(start).toBeDisabled();
    await savedPanel
      .getByRole("textbox", { name: "App bundle or package ID" })
      .fill("com.tabs.fresh");
    await start.click();
    expect(calls).toHaveBeenCalledWith({
      action: "start",
      threadId,
      device: { hostId: freshDevice.hostId, deviceId: freshDevice.id },
      appId: "com.tabs.fresh",
    });
    await expect.element(savedPanel).not.toBeInTheDocument();
    await expect.element(page.getByText("0 recorded steps")).toBeVisible();
  } finally {
    await view.unmount();
    store.close(scope, tabId);
  }
});

it("records short iPhone source taps against the current observation", async () => {
  const firstObservation = crypto.randomUUID();
  const nextObservation = crypto.randomUUID();
  let observationId: string | undefined = firstObservation;
  let run: DeviceComparisonReport = {
    runId,
    phase: "recording",
    source,
    busy: false,
    playing: false,
    completedSteps: 0,
    steps: [],
    canResume: false,
    uncertainTap: false,
  };
  let acknowledgeTap!: () => void;
  const tapAck = new Promise<void>((resolve) => {
    acknowledgeTap = resolve;
  });
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    if (input.action === "sourceTap") {
      await tapAck;
      observationId = undefined;
      run = { ...run, steps: [{ label: "Continue" }] };
    }
    return {
      run,
      ownerThreadId: threadId,
      ...(observationId ? { sourceTapId: observationId } : {}),
      controls: [
        {
          id: controlId,
          label: observationId === firstObservation ? "Next" : "Continue",
          role: "button",
          canTap: true,
        },
      ],
    };
  });
  fake.api.comparison = calls;
  const tapCalls = () =>
    calls.mock.calls.flatMap(([input]) => (input.action === "sourceTap" ? [input] : []));
  const state = fakeDeviceState({
    hubBasePath: "/api/device-hub",
    agentAccessEnabled: true,
    devices: [fakeDevice({ ...source, id: source.deviceId, booted: true })],
    sessions: [{ ...source, threadId, openedAt: "now" }],
  });
  const restoreMedia = await mockComparisonDeviceMedia(state.hubBasePath, source, 120, 240);
  acceptDeviceState(state);
  const view = await render(
    <div style={{ width: 390 }}>
      <CompanionDevicePanel
        surface={{
          ...source,
          id: "recording-source",
          kind: "device",
          title: source.name,
        }}
        scope="checkout"
        threadId={threadId}
      />
    </div>,
  );
  try {
    const screen = page.getByRole("application", { name: "Device screen" });
    await expect.element(screen).toHaveAttribute("aria-disabled", "false");
    await expect.poll(() => view.container.querySelector("img")?.naturalWidth).toBe(120);
    const frame = view.container.querySelector("img")!;
    frame.style.height = "160px";
    const rect = frame.getBoundingClientRect();
    const x = (rect.width - 80) / 2 + 60;
    const y = 64;
    const node = screen.element();
    const capture = vi.spyOn(node, "setPointerCapture").mockImplementation(() => {});
    const pointer = (type: "pointerdown" | "pointermove" | "pointerup", offsetX: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: rect.left + offsetX,
          clientY: rect.top + y,
        }),
      );
    // The image bounds apply to both ends, and each move counts toward the travel limit.
    pointer("pointerdown", 2);
    pointer("pointerup", 2);
    expect(capture).not.toHaveBeenCalled();
    const imageLeft = (rect.width - 80) / 2;
    pointer("pointerdown", imageLeft + 0.5);
    pointer("pointerup", imageLeft - 0.5);
    pointer("pointerdown", x);
    pointer("pointermove", x - 1);
    pointer("pointermove", x);
    pointer("pointerup", x);
    expect(tapCalls()).toHaveLength(0);

    pointer("pointerdown", x);
    observationId = nextObservation;
    await expect.element(page.getByRole("option", { name: "Continue" })).toBeInTheDocument();
    pointer("pointerup", x);
    expect(tapCalls()).toHaveLength(0);
    capture.mockRestore();

    await expect.element(page.getByRole("button", { name: "Rotate" })).toBeDisabled();
    await screen.click({ position: { x, y } });
    expect(tapCalls()).toEqual([
      {
        action: "sourceTap",
        threadId,
        runId,
        device: { hostId: source.hostId, deviceId: source.deviceId },
        observationId: nextObservation,
        x: expect.closeTo(0.75, 1),
        y: expect.closeTo(0.4, 1),
        viewport: { width: 120, height: 240 },
      },
    ]);
    const scroll = page.getByRole("button", { name: "Scroll down" });
    await expect.element(scroll).toBeDisabled();
    await expect.element(screen).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("a");
    pointer("pointerdown", x);
    pointer("pointerup", x);
    acknowledgeTap();
    await expect.element(page.getByText("1 recorded step")).toBeVisible();
    await expect.element(scroll).toBeEnabled();
    await expect.element(page.getByRole("combobox", { name: "Accessible control" })).toBeEnabled();
    await expect.element(screen).toHaveAttribute("aria-disabled", "true");
    expect(tapCalls()).toHaveLength(1);
    expect(calls.mock.calls.some(([input]) => input.action === "manualInput")).toBe(false);
  } finally {
    acknowledgeTap();
    await view.unmount();
    restoreMedia();
  }
});

it("records a scroll and asks for its visible result before finishing the demonstration", async () => {
  let run: DeviceComparisonReport = {
    runId,
    phase: "recording",
    source,
    busy: false,
    playing: false,
    completedSteps: 0,
    steps: [],
    canResume: false,
    uncertainTap: false,
  };
  const calls = vi.fn<typeof fake.api.comparison>(async (input) => {
    if (input.action === "scroll")
      run = {
        ...run,
        steps: [{ label: "Scroll down", scrollDirection: input.direction }],
      };
    if (input.action === "expect")
      run = {
        ...run,
        steps: [{ ...run.steps[0]!, expected: "Delivery options" }],
      };
    return {
      run,
      controls:
        run.steps.length === 0
          ? []
          : [
              {
                id: controlId,
                label: "Delivery options",
                role: "text",
                canTap: false,
              },
            ],
    };
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      agentAccessEnabled: true,
      devices: [fakeDevice({ ...source, id: source.deviceId, booted: true })],
      sessions: [{ ...source, threadId, openedAt: "now" }],
    }),
  );
  const view = await render(
    <AppAtomRegistryProvider>
      <CompanionDevicePanel
        surface={{
          ...source,
          id: "scroll-source",
          kind: "device",
          title: source.name,
        }}
        scope="checkout"
        threadId={threadId}
      />
    </AppAtomRegistryProvider>,
  );
  try {
    const panel = page.getByRole("region", { name: "Device comparison" });
    await panel.getByRole("button", { name: "Scroll down" }).click();
    expect(calls).toHaveBeenCalledWith({
      action: "scroll",
      threadId,
      runId,
      direction: "down",
    });
    const finish = panel.getByRole("button", { name: "Finish demonstration" });
    await expect.element(finish).toBeDisabled();
    await expect.element(panel.getByRole("button", { name: "Scroll up" })).toBeDisabled();
    await panel.getByRole("combobox", { name: "Accessible control" }).selectOptions(controlId);
    await panel.getByRole("button", { name: "Mark expected result" }).click();
    expect(calls).toHaveBeenCalledWith({
      action: "expect",
      threadId,
      runId,
      controlId,
    });
    await expect.element(finish).toBeEnabled();
  } finally {
    await view.unmount();
  }
});

it("takes over, stops and restores ordinary agent control on the selected host", async () => {
  const otherThread = ThreadId.make("other-checkout");
  let phase: NonNullable<DeviceComparisonStatus["agentControl"]>["phase"] = "agent";
  const calls = vi.fn<typeof fake.api.comparison>(async (request) => {
    switch (request.action) {
      case "takeoverAgentControl":
        phase = "manual";
        break;
      case "allowAgentControl":
        phase = "agent";
        break;
      case "stopAgentControl":
        phase = "stopped";
        break;
    }
    return {
      agentControl: {
        id: controlId,
        phase,
        threadId: phase === "agent" ? otherThread : threadId,
      },
    };
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [source, target].map((device) =>
        fakeDevice({ ...device, id: device.deviceId, booted: true }),
      ),
      sessions: [source, target].map((device) => ({
        ...device,
        threadId,
        openedAt: "now",
      })),
    }),
  );
  await render(
    <CompanionDevicePanel
      surface={{ ...target, id: "pixel-tab", kind: "device", title: "Pixel" }}
      scope="checkout"
      threadId={threadId}
    />,
  );
  const controls = page.getByRole("region", { name: "Device control" });
  const home = page.getByRole("button", { name: "Home", exact: true });
  const device = { hostId: target.hostId, deviceId: target.deviceId };
  await expect
    .element(controls.getByText("Controlled by the agent in thread other-checkout"))
    .toBeVisible();
  await expect.element(home).toBeDisabled();
  await controls.getByRole("button", { name: "My turn" }).click();
  expect(calls).toHaveBeenCalledWith({
    action: "takeoverAgentControl",
    device,
    controlId,
    threadId,
  });
  await expect.element(controls.getByText("Manual control")).toBeVisible();
  await expect.element(home).toBeEnabled();
  await controls.getByRole("button", { name: "Allow agent control" }).click();
  expect(calls).toHaveBeenCalledWith({
    action: "allowAgentControl",
    device,
    controlId,
    threadId,
  });
  await controls.getByRole("button", { name: "Stop agent" }).click();
  expect(calls).toHaveBeenCalledWith({
    action: "stopAgentControl",
    device,
    controlId,
    threadId,
  });
  await expect.element(controls.getByText("Agent control stopped")).toBeVisible();
  await expect.element(home).toBeEnabled();
});

it("reviews the app and returns the exact approved device to the original thread", async () => {
  dispatchCommand.mockClear();
  const approval = { id: crypto.randomUUID(), appId: "com.tabs.review" };
  const selected = { hostId: target.hostId, deviceId: target.deviceId };
  let pending = true;
  const calls = vi.fn<typeof fake.api.comparison>(async (request) => {
    if (request.action === "approveDeviceApp") {
      pending = false;
      return { approvedApp: approval };
    }
    return pending ? { pendingAppApproval: approval } : {};
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [fakeDevice({ ...target, id: target.deviceId, booted: true })],
      sessions: [{ ...target, threadId, openedAt: "now" }],
    }),
  );
  await render(
    <CompanionDevicePanel
      surface={{ ...target, id: "pixel-tab", kind: "device", title: "Pixel" }}
      scope="checkout"
      threadId={threadId}
    />,
  );
  const review = page.getByRole("region", { name: "Device app approval" });
  await expect.element(review).toHaveTextContent(approval.appId);
  await expect.element(review).toHaveTextContent(target.name);
  expect(dispatchCommand).not.toHaveBeenCalled();
  await review.getByRole("button", { name: "Approve app access" }).click();
  expect(calls).toHaveBeenCalledWith({
    action: "approveDeviceApp",
    device: selected,
    approvalId: approval.id,
    threadId,
  });
  await vi.waitFor(() =>
    expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        commandId: approval.id,
        threadId,
        text: expect.stringContaining(
          JSON.stringify({
            ...selected,
            appId: approval.appId,
            approvalId: approval.id,
          }),
        ),
      }),
    ),
  );
});

it("returns the displayed app with a correction and retries a lost continuation", async () => {
  const appId = "com.tabs.checkout";
  const resumedId = crypto.randomUUID();
  let status: DeviceComparisonStatus = {
    agentControl: { id: controlId, phase: "agent", threadId },
  };
  const calls = vi.fn<typeof fake.api.comparison>(async (request) => {
    if (request.action === "takeoverAgentControl")
      status = {
        agentControl: {
          id: controlId,
          phase: "manual",
          threadId,
          returnToApp: { appId },
        },
      };
    if (request.action === "returnAgentControl") {
      const pending = status.agentControl?.pendingReturn;
      status = {
        agentControl: {
          id: resumedId,
          phase: "agent",
          threadId,
          ...(!pending && { pendingReturn: { controlId, appId } }),
        },
      };
      if (!pending) throw new Error("Could not confirm the continuation");
    }
    return status;
  });
  fake.api.comparison = calls;
  acceptDeviceState(
    fakeDeviceState({
      hubBasePath: "",
      agentAccessEnabled: true,
      devices: [fakeDevice({ ...target, id: target.deviceId, booted: true })],
      sessions: [{ ...target, threadId, openedAt: "now" }],
    }),
  );
  await render(
    <CompanionDevicePanel
      surface={{ ...target, id: "pixel-tab", kind: "device", title: "Pixel" }}
      scope="checkout"
      threadId={threadId}
    />,
  );
  const controls = page.getByRole("region", { name: "Device control" });
  await controls.getByRole("button", { name: "My turn" }).click();
  await expect.element(controls.getByText(appId)).toBeVisible();
  await controls
    .getByRole("textbox", {
      name: "What did you change? (optional, shared with this conversation)",
    })
    .fill("Selected guest checkout.");
  await controls.getByRole("button", { name: "Return to agent" }).click();
  const returned = {
    action: "returnAgentControl",
    device: { hostId: target.hostId, deviceId: target.deviceId },
    controlId,
    threadId,
    appId,
  };
  expect(calls).toHaveBeenCalledWith({
    ...returned,
    meaning: "Selected guest checkout.",
  });
  const retry = controls.getByRole("button", { name: "Tell the agent again" });
  await retry.click();
  expect(calls).toHaveBeenCalledWith(returned);
  await expect.element(retry).not.toBeInTheDocument();
});
