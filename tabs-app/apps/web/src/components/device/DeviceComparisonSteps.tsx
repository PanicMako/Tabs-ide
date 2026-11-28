import { useState } from "react";
import type { DeviceComparisonReport, DeviceComparisonTarget } from "@tabs/contracts";
import { appIdValid } from "./deviceComparisonShared";
import type { useDeviceComparison } from "./useDeviceComparison";

export function StartDemonstrationForm({
  target,
  send,
  disabled,
  label,
}: {
  target: DeviceComparisonTarget;
  send: ReturnType<typeof useDeviceComparison>["send"];
  disabled: boolean;
  label: string;
}) {
  const [appId, setAppId] = useState("");
  return (
    <form
      className="dv-comparison-form"
      onSubmit={(event) => {
        event.preventDefault();
        void send({ action: "start", device: target, appId: appId.trim() });
      }}
    >
      <label>
        App bundle or package ID
        <input value={appId} onChange={(event) => setAppId(event.target.value)} maxLength={255} />
      </label>
      <button className="sl-primary" disabled={disabled || !appIdValid(appId)}>
        {label}
      </button>
    </form>
  );
}

export function RecordedSteps({ steps }: { steps: DeviceComparisonReport["steps"] }) {
  return (
    <details>
      <summary>Recorded steps</summary>
      <ol className="dv-comparison-steps">
        {steps.map((step, index) => (
          <li key={index}>
            {step.label}
            {step.expected && ` · Expect ${step.expected}`}
          </li>
        ))}
      </ol>
    </details>
  );
}
