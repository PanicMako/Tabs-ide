import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { configureDevices, useDeviceStore } from "~/device/deviceStore";
import { deviceSetupSteps, devicePlatformNotes } from "~/device/deviceLogic";
import type { DeviceApi } from "~/device/useDeviceApi";

/** First-run setup in three plain steps. Nothing downloads or starts until step one is chosen. */
export function DeviceSetup({ api }: { api: DeviceApi }) {
  const state = useDeviceStore((s) => s.state);
  const error = useDeviceStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState(false);
  const steps = deviceSetupSteps(state);
  const hubDone = steps[0]!.done;
  const hubInstalled = !!state?.hosts.some((host) => host.hubInstalled);
  const notes = devicePlatformNotes(state);
  const starting = state?.hostStatus === "installing" || state?.hostStatus === "starting";

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
    <div className="device-setup" role="region" aria-label="Device setup">
      <h2 className="device-title">Set up devices</h2>
      <p className="device-muted">
        Watch an iOS Simulator or Android Emulator next to your thread. Nothing is downloaded or
        started until you choose to.
      </p>
      <ol className="device-steps">
        <li data-done={hubDone}>
          <StepHeading n={1} done={hubDone} title="Start the device hub" />
          <p className="device-muted">
            {hubInstalled
              ? "The device hub is already installed here and will be reused."
              : "The hub streams the screen and relays your touches. It installs once on this machine."}
          </p>
          {!hubDone && (
            <Button size="sm" disabled={busy || starting} onClick={() => void startHub()}>
              {starting ? "Starting…" : hubInstalled ? "Use device hub" : "Install and start"}
            </Button>
          )}
        </li>
        <li data-done={false} aria-disabled={!hubDone}>
          <StepHeading n={2} done={false} title="Check iOS and Android support" />
          {hubDone ? (
            <ul className="device-notes">
              {notes.map((note) => (
                <li key={note.platform}>
                  <strong>{note.platform === "ios" ? "iOS" : "Android"}</strong>{" "}
                  {note.fix ? note.fix : "Ready."}
                </li>
              ))}
            </ul>
          ) : (
            <p className="device-muted">Available after the hub starts.</p>
          )}
        </li>
        <li data-done={false} aria-disabled={!hubDone}>
          <StepHeading n={3} done={false} title="Let agents use devices?" />
          <label className="device-row">
            <Switch checked={agents} disabled={!hubDone} onCheckedChange={setAgents} />
            <span>Agents can use devices</span>
          </label>
          <p className="device-muted">
            Restart an existing agent session after turning this on so it receives device access.
            The first iOS tap builds a test runner once, which takes a couple of minutes.
          </p>
          <Button size="sm" disabled={!hubDone || busy} onClick={() => void finish()}>
            Finish setup
          </Button>
        </li>
      </ol>
      {error && (
        <p role="alert" className="device-error">
          {error}
        </p>
      )}
    </div>
  );
}

function StepHeading({ n, done, title }: { n: number; done: boolean; title: string }) {
  return (
    <h3 className="device-step-title">
      <span className="device-step-mark" aria-hidden="true">
        {done ? <CheckIcon size={12} /> : n}
      </span>
      {title}
    </h3>
  );
}
