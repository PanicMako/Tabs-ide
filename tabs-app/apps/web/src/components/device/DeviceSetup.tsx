import { useRef, useState } from "react";
import { Switch } from "~/components/ui/switch";
import { useStaggerIn } from "~/components/agents/companion/designs/motion";
import { configureDevices, useDeviceStore } from "~/device/deviceStore";
import { deviceSetupSteps, devicePlatformNotes } from "~/device/deviceLogic";
import type { DeviceApi } from "~/device/useDeviceApi";
import "./device.css";

/** First-run setup: three plain steps, each with one line saying what it does. */
export function DeviceSetup({ api }: { api: DeviceApi }) {
  const state = useDeviceStore((s) => s.state);
  const error = useDeviceStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const hubDone = deviceSetupSteps(state)[0]!.done;
  const hubInstalled = !!state?.hosts.some((host) => host.hubInstalled);
  const starting = state?.hostStatus === "installing" || state?.hostStatus === "starting";
  const notes = devicePlatformNotes(state);
  useStaggerIn(list, ".dv-row", hubDone ? "ready" : "start", { y: 12, stagger: 0.05 });

  const startHub = async () => {
    setBusy(true);
    await configureDevices(api, { enabled: true });
    setBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    await configureDevices(api, {
      enabled: true,
      agentAccessEnabled: agents,
      onboardingCompleted: true,
    });
    setBusy(false);
  };

  return (
    <div className="dv-page" role="region" aria-label="Device setup">
      <div>
        <h2 className="dv-title">Devices</h2>
        <p className="dv-lede">
          Watch a simulator or emulator beside your thread and tap it yourself. Nothing downloads or
          starts until you say so.
        </p>
      </div>
      <div className="dv-ledger" ref={list}>
        <div className="dv-ledger-head">
          <span>Three steps</span>
          <span>{hubDone ? "Hub ready" : "Not started"}</span>
        </div>
        <div className="dv-row" data-done={hubDone}>
          <span className="dv-index">01</span>
          <div className="dv-row-main">
            <span className="dv-name">Start the device hub</span>
            <span className="dv-muted">
              {hubInstalled
                ? "Already installed on this machine. It will be reused."
                : "Streams the screen and relays your touches. Installs once."}
            </span>
          </div>
          {hubDone ? (
            <span className="dv-state" data-running="true">
              Done
            </span>
          ) : (
            <button
              type="button"
              className="sl-primary rounded-full"
              disabled={busy || starting}
              onClick={() => void startHub()}
            >
              {starting ? "Starting…" : hubInstalled ? "Use hub" : "Install and start"}
            </button>
          )}
        </div>
        <div className="dv-row" aria-disabled={!hubDone}>
          <span className="dv-index">02</span>
          <div className="dv-row-main">
            <span className="dv-name">Check iOS and Android</span>
            <span className="dv-muted">
              iOS needs a Mac with Xcode. Android needs the SDK tools and an emulator.
            </span>
          </div>
          <span className="dv-state">{hubDone ? "" : "After step 1"}</span>
          {hubDone && (
            <div className="dv-row-extra">
              {notes.map((note) => (
                <p key={note.platform}>
                  <strong className="text-foreground">
                    {note.platform === "ios" ? "iOS" : "Android"}
                  </strong>{" "}
                  {note.fix ?? "Ready."}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="dv-row" aria-disabled={!hubDone}>
          <span className="dv-index">03</span>
          <div className="dv-row-main">
            <span className="dv-name">Let agents use devices?</span>
            <span className="dv-muted">
              Lets agents tap and read the screen. Restart a running agent session to pick it up.
              The first iOS tap builds a test runner once, which takes a couple of minutes.
            </span>
          </div>
          <Switch
            checked={agents}
            disabled={!hubDone}
            aria-label="Agents can use devices"
            onCheckedChange={setAgents}
          />
        </div>
      </div>
      <div className="dv-actions">
        <button
          type="button"
          className="sl-primary rounded-full"
          disabled={!hubDone || busy}
          onClick={() => void finish()}
        >
          Finish setup
        </button>
      </div>
      {error && (
        <p role="alert" className="dv-error">
          {error}
        </p>
      )}
    </div>
  );
}
