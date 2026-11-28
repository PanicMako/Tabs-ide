import { scopedComposerThreadId } from "~/state/composerDrafts";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  EnvironmentId,
  type DeviceComparisonGesture,
  type DeviceSummary,
  type ThreadId,
} from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { getPrimaryEnvironmentId } from "~/connection/environmentApiRegistry";
import { threadsAtom } from "~/state/threads";
import { closeDevice, openDevice, shutdownDevice, useDeviceState } from "~/device/deviceStore";
import { isDeviceSetupComplete } from "~/device/deviceLogic";
import { useDeviceApi } from "~/device/useDeviceApi";
import { useCompanionSurfaceStore, type CompanionSurface } from "~/stores/companionSurfaceStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { clampFloatPosition, defaultFloatPosition, floatSizeFor } from "~/device/deviceFloat";
import "./device.css";
import { DeviceComparisonPanel, useDeviceComparison } from "./DeviceComparisonPanel";
import { DevicePicker } from "./DevicePicker";
import { DeviceSetup } from "./DeviceSetup";
import { AGENT_HANDOFF_DESCRIPTIONS, AGENT_HANDOFF_LABELS } from "~/lib/agentHandoffLabels";
import { DeviceStreamView, type DeviceSourceInput } from "./DeviceStreamView";
import { DeviceToolsDrawer } from "./DeviceToolsDrawer";

/** The Device right-panel surface: setup, then picker, then the live screen. */
export function CompanionDevicePanel({
  surface,
  scope,
  threadId,
  environmentId,
  visible = true,
}: {
  surface: CompanionSurface;
  scope: string;
  threadId?: ThreadId | null | undefined;
  environmentId?: string | null | undefined;
  visible?: boolean;
}) {
  const api = useDeviceApi(environmentId);
  const state = useDeviceState(api, (s) => s.state);
  const error = useDeviceState(api, (s) => s.error);
  const [tools, setTools] = useState(false);
  const update = useCompanionSurfaceStore((s) => s.update);
  const hostId = surface.hostId ?? "local";
  const comparison = useDeviceComparison(
    api,
    threadId,
    hostId,
    surface.platform ? surface.deviceId : undefined,
    visible,
    environmentId,
  );
  const agentControl = comparison.status?.agentControl;
  const appApproval = comparison.status?.pendingAppApproval;
  const [correctionNote, setCorrectionNote] = useState<{
    controlId: string;
    text: string;
  }>();
  const returnToApp = agentControl?.returnToApp;
  const pendingReturn = agentControl?.pendingReturn;
  const manualControlId = comparison.status?.manualControlId;
  const run = comparison.status?.run;
  const [pendingControl, setPendingControl] = useState<string>();
  const inputQueue = useRef<{
    id: string;
    pending: number;
    failed: boolean;
    tail: Promise<void>;
  }>(undefined);
  useEffect(() => {
    setPendingControl(undefined);
    return () => {
      inputQueue.current = undefined;
    };
  }, [manualControlId, visible]);
  const manualInput =
    visible && manualControlId && run
      ? {
          id: manualControlId,
          send(gesture: DeviceComparisonGesture) {
            let queue = inputQueue.current;
            if (!queue || queue.id !== manualControlId || queue.pending === 0) {
              queue = {
                id: manualControlId,
                pending: 0,
                failed: false,
                tail: Promise.resolve(),
              };
              inputQueue.current = queue;
            }
            const current = queue;
            if (current.pending >= 128) return;
            current.pending += 1;
            setPendingControl(manualControlId);
            current.tail = current.tail
              .then(async () => {
                if (inputQueue.current !== current || current.failed) return;
                const response = await comparison.send({
                  action: "manualInput",
                  runId: run.runId,
                  controlId: manualControlId,
                  gesture,
                });
                if (!response) current.failed = true;
              })
              .finally(() => {
                current.pending -= 1;
                if (inputQueue.current === current && current.pending === 0)
                  setPendingControl(undefined);
              });
          },
        }
      : undefined;
  const deviceEnvironmentId = environmentId ?? getPrimaryEnvironmentId();
  const projectId = useAtomValue(
    threadsAtom,
    (threads) =>
      threads.find(
        (thread) =>
          thread.id === threadId && (thread.environmentId ?? null) === deviceEnvironmentId,
      )?.projectId,
  );
  const ownerTitle = useAtomValue(
    threadsAtom,
    (threads) =>
      threads.find(
        (thread) =>
          thread.id === agentControl?.threadId && thread.environmentId === deviceEnvironmentId,
      )?.title,
  );
  const managedInputBlocked =
    comparison.status?.ownerThreadId !== undefined ||
    agentControl?.phase === "agent" ||
    agentControl?.phase === "stopping";

  const setupComplete = isDeviceSetupComplete(state);
  const hasSavedComparison = comparison.status?.run?.savedAt !== undefined;
  const savedComparison =
    threadId && hasSavedComparison ? (
      <DeviceComparisonPanel
        key={JSON.stringify([environmentId, threadId])}
        threadId={threadId}
        devices={state?.devices ?? []}
        sessions={state?.sessions ?? []}
        comparison={comparison}
        canStart={setupComplete && state?.agentAccessEnabled === true}
      />
    ) : null;

  if (!api || !state)
    return (
      <div className="dv-panel">
        {savedComparison}
        <p className="dv-page dv-muted">Loading devices…</p>
      </div>
    );
  if (!setupComplete)
    return (
      <div className="dv-panel">
        {savedComparison}
        <DeviceSetup api={api} />
      </div>
    );

  if (!surface.deviceId || !surface.platform) {
    const choose = async (device: DeviceSummary) => {
      if (!threadId) return;
      const session = await openDevice(api, {
        threadId,
        hostId: device.hostId,
        deviceId: device.id,
        platform: device.platform,
      });
      if (session)
        update(scope, surface.id, {
          hostId: session.hostId,
          deviceId: session.deviceId,
          platform: session.platform,
          title: device.name,
        });
    };
    return (
      <div className="dv-panel">
        {savedComparison}
        <DevicePicker api={api} onChoose={(device) => void choose(device)} />
        {!threadId && <p className="dv-muted">Open a thread to attach a device.</p>}
      </div>
    );
  }

  const { deviceId, platform } = surface;
  const sourceRecording =
    platform === "ios" &&
    run?.phase === "recording" &&
    !run.agentRecording &&
    run.source.hostId === hostId &&
    run.source.deviceId === deviceId;
  const observationId = comparison.sourceTapId;
  const sourceInput: DeviceSourceInput | null | undefined = sourceRecording
    ? observationId && !run.uncertainTap
      ? {
          observationId,
          send: (point) => {
            void comparison.send({
              action: "sourceTap",
              runId: run.runId,
              device: { hostId, deviceId },
              observationId,
              ...point,
            });
          },
        }
      : null
    : undefined;
  const deviceInputBlocked = managedInputBlocked || sourceRecording;
  const powerOff = async () => {
    if ((await shutdownDevice(api, { hostId, deviceId, platform })) === null) return;
    update(scope, surface.id, {
      deviceId: undefined as never,
      platform: undefined as never,
    });
  };
  const attach = (blob: Blob) => {
    if (!threadId) return;
    const file = new File([blob], "device-screenshot.png", {
      type: "image/png",
    });
    useComposerDraftStore
      .getState()
      .addImage(
        environmentId
          ? scopedComposerThreadId(EnvironmentId.make(environmentId), threadId)
          : threadId,
        {
          type: "image",
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl: URL.createObjectURL(file),
          file,
        },
      );
  };
  const floating = surface.floating === true;
  const toggleFloat = () => update(scope, surface.id, { floating: !floating });
  const body = (
    <>
      {threadId && appApproval && (
        <section className="dv-comparison" aria-label="Device app approval">
          <p>
            Allow this conversation to open and control <code>{appApproval.appId}</code>?
          </p>
          <p className="dv-muted" title={`${hostId} · ${deviceId}`}>
            {surface.title}
          </p>
          <div className="dv-comparison-buttons">
            {(
              [
                ["approveDeviceApp", "Approve app access"],
                ["declineDeviceApp", "Decline"],
              ] as const
            ).map(([action, label]) => (
              <button
                key={action}
                type="button"
                className="dv-link"
                disabled={comparison.sending}
                onClick={() =>
                  void comparison.send({
                    action,
                    device: { hostId, deviceId },
                    approvalId: appApproval.id,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          {comparison.failure && (
            <p className="dv-error" role="alert">
              {comparison.failure}
            </p>
          )}
        </section>
      )}
      {threadId && agentControl && (
        <section className="dv-comparison" aria-label="Device control">
          <p className="dv-muted" role="status">
            {agentControl.phase === "stopping"
              ? "Waiting for the current agent command to finish."
              : agentControl.phase === "manual"
                ? "Manual control"
                : agentControl.phase === "stopped"
                  ? "Agent control stopped"
                  : agentControl.threadId === threadId
                    ? "Controlled by this thread’s agent"
                    : `Controlled by the agent in ${ownerTitle || `thread ${agentControl.threadId}`}`}
          </p>
          {returnToApp && (
            <form
              className="dv-comparison-form"
              onSubmit={(event) => {
                event.preventDefault();
                void comparison.send({
                  action: "returnAgentControl",
                  device: { hostId, deviceId },
                  controlId: agentControl.id,
                  appId: returnToApp.appId,
                  ...(correctionNote?.controlId === agentControl.id && {
                    meaning: correctionNote.text,
                  }),
                });
              }}
            >
              <p>
                Return <code>{returnToApp.appId}</code> to this conversation.
              </p>
              <label>
                What did you change? (optional, shared with this conversation)
                <input
                  maxLength={300}
                  disabled={comparison.sending}
                  value={correctionNote?.controlId === agentControl.id ? correctionNote.text : ""}
                  onChange={(event) =>
                    setCorrectionNote({
                      controlId: agentControl.id,
                      text: event.target.value,
                    })
                  }
                />
              </label>
              <div className="dv-comparison-buttons">
                <button
                  type="submit"
                  className="dv-link"
                  title={AGENT_HANDOFF_DESCRIPTIONS.returnToAgent}
                  disabled={comparison.sending}
                >
                  {AGENT_HANDOFF_LABELS.returnToAgent}
                </button>
              </div>
            </form>
          )}
          {pendingReturn && (
            <button
              type="button"
              className="dv-link"
              title={AGENT_HANDOFF_DESCRIPTIONS.retryContinuation}
              aria-description={AGENT_HANDOFF_DESCRIPTIONS.retryContinuation}
              disabled={comparison.sending}
              onClick={() =>
                void comparison.send({
                  action: "returnAgentControl",
                  device: { hostId, deviceId },
                  controlId: pendingReturn.controlId,
                  appId: pendingReturn.appId,
                })
              }
            >
              {AGENT_HANDOFF_LABELS.retryContinuation}
            </button>
          )}
          {agentControl.phase !== "stopping" &&
            !(agentControl.phase === "manual" && returnToApp) && (
              <div className="dv-comparison-buttons">
                {(agentControl.phase === "manual" || agentControl.phase === "stopped"
                  ? ([["allowAgentControl", AGENT_HANDOFF_LABELS.allowAgent, undefined]] as const)
                  : ([
                      [
                        "takeoverAgentControl",
                        AGENT_HANDOFF_LABELS.takeOver,
                        AGENT_HANDOFF_DESCRIPTIONS.takeOver,
                      ],
                      [
                        "stopAgentControl",
                        AGENT_HANDOFF_LABELS.stopAgent,
                        AGENT_HANDOFF_DESCRIPTIONS.stopAgent,
                      ],
                    ] as const)
                ).map(([action, label, description]) => (
                  <button
                    key={action}
                    type="button"
                    className="dv-link"
                    title={description}
                    disabled={comparison.sending}
                    onClick={() =>
                      void comparison.send({
                        action,
                        device: { hostId, deviceId },
                        controlId: agentControl.id,
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          {comparison.failure && (
            <p className="dv-error" role="alert">
              {comparison.failure}
            </p>
          )}
        </section>
      )}
      {threadId && (hasSavedComparison || (state.agentAccessEnabled && !agentControl)) && (
        <DeviceComparisonPanel
          key={JSON.stringify([environmentId, threadId, hostId, deviceId])}
          target={{ hostId, deviceId }}
          threadId={threadId}
          devices={state.devices}
          sessions={state.sessions}
          comparison={comparison}
          projectId={projectId}
          environmentId={environmentId}
          manualPending={manualControlId !== undefined && pendingControl === manualControlId}
          canStart={state.agentAccessEnabled && !agentControl}
        />
      )}
      <DeviceStreamView
        api={api}
        key={JSON.stringify([environmentId, hostId, deviceId, platform])}
        hostId={hostId}
        deviceId={deviceId}
        platform={platform}
        visible={visible}
        inputDisabled={
          sourceInput === null ||
          (sourceInput === undefined &&
            managedInputBlocked &&
            (!manualInput || run?.busy === true || run?.uncertainTap === true))
        }
        manualInput={manualInput}
        sourceInput={sourceInput}
        onPowerOff={() => void powerOff()}
        toolsOpen={tools && !deviceInputBlocked}
        onToggleTools={() => setTools((value) => !value)}
        onScreenshot={threadId ? attach : undefined}
        floating={floating}
        onToggleFloat={toggleFloat}
      />
      <DeviceToolsDrawer
        api={api}
        hostId={hostId}
        deviceId={deviceId}
        platform={platform}
        open={tools && !deviceInputBlocked}
        onClose={() => setTools(false)}
      />
    </>
  );
  return (
    <div className="dv-panel">
      {floating ? (
        <>
          <div className="dv-empty">
            <strong>Floating over the chat</strong>
            <span className="dv-muted">
              This device is in its own window. Drag it by the title.
            </span>
            <button type="button" className="dv-link" onClick={toggleFloat}>
              Return to panel
            </button>
          </div>
          {createPortal(
            <DeviceFloatWindow
              title={surface.title ?? "Device"}
              x={surface.floatX}
              y={surface.floatY}
              onMove={(x, y) => update(scope, surface.id, { floatX: x, floatY: y })}
              onReturn={toggleFloat}
            >
              {body}
            </DeviceFloatWindow>,
            document.body,
          )}
        </>
      ) : (
        body
      )}
      {error && (
        <p role="alert" className="dv-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A device in a window of its own over the chat. Drag the title to move it. */
export function DeviceFloatWindow({
  title,
  x,
  y,
  onMove,
  onReturn,
  children,
}: {
  title: string;
  x?: number | undefined;
  y?: number | undefined;
  onMove: (x: number, y: number) => void;
  onReturn: () => void;
  children: React.ReactNode;
}) {
  const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const size = floatSizeFor(viewport());
  const start = defaultFloatPosition(size, viewport());
  const [position, setPosition] = useState(
    clampFloatPosition({ x: x ?? start.x, y: y ?? start.y }, size, viewport()),
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // A smaller window must not leave it stranded off screen.
  useEffect(() => {
    const onResize = () =>
      setPosition((current) => clampFloatPosition(current, floatSizeFor(viewport()), viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      className="dv-float"
      role="dialog"
      aria-label={`${title} floating over the chat`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      <div
        className="dv-float-title"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          drag.current = {
            dx: event.clientX - position.x,
            dy: event.clientY - position.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPosition(
            clampFloatPosition(
              {
                x: event.clientX - drag.current.dx,
                y: event.clientY - drag.current.dy,
              },
              size,
              viewport(),
            ),
          );
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onMove(position.x, position.y);
        }}
      >
        <span className="dv-float-name">{title}</span>
        <button type="button" className="dv-link" onClick={onReturn}>
          Return to panel
        </button>
      </div>
      <div className="dv-float-body">{children}</div>
    </div>
  );
}

/** Called when a device tab closes: stop watching, leave the device running. */
export async function closeDeviceTab(
  environmentId: string | null | undefined,
  surface: CompanionSurface,
  threadId: ThreadId | null | undefined,
): Promise<void> {
  if (!surface.deviceId || !threadId) return;
  const { environmentApi } = await import("~/connection/environmentApiRegistry");
  const native = await environmentApi(environmentId ?? null);
  if (native.device)
    await closeDevice(native.device, {
      hostId: surface.hostId ?? "local",
      threadId,
      deviceId: surface.deviceId,
    });
}
