import { useEffect, useState } from "react";
import type { DeviceComparisonReport, DeviceComparisonStatus } from "@tabs/contracts";
import { deviceKey } from "./deviceComparisonShared";
import type { useDeviceComparison } from "./useDeviceComparison";

// Status polling carries metadata; the frames are loaded separately for the displayed run.
export function DeviceComparisonEvidence({
  run,
  send,
}: {
  run: DeviceComparisonReport;
  send: ReturnType<typeof useDeviceComparison>["send"];
}) {
  const [result, setResult] = useState<{
    images: DeviceComparisonStatus["evidence"];
  } | null>();
  const { runId, firstDifference: difference, busy } = run;
  const step = difference?.step;

  useEffect(() => {
    if (busy || step === undefined || result !== undefined) return;
    let disposed = false;
    void send({ action: "evidence", runId }).then((response) => {
      if (!disposed) setResult(response ? { images: response.evidence } : null);
    });
    return () => {
      disposed = true;
    };
  }, [busy, step, result, runId, send]);

  return (
    <DeviceComparisonScreens
      run={run}
      images={result?.images}
      loading={result === undefined}
      retry={result === null ? () => setResult(undefined) : undefined}
    />
  );
}

export function DeviceComparisonScreens({
  run,
  images,
  loading = false,
  showIdentity = run.savedAt !== undefined,
  retry,
}: {
  run: DeviceComparisonReport;
  images: DeviceComparisonStatus["evidence"];
  loading?: boolean;
  showIdentity?: boolean;
  retry?: (() => void) | undefined;
}) {
  const difference = run.firstDifference;
  if (!difference) return null;
  const label = run.steps[difference.step - 1]?.label;
  return (
    <section className="dv-comparison-evidence" aria-label="First difference">
      <strong>
        First difference · Step {difference.step}
        {label && ` · ${label}`}
      </strong>
      <p>{difference.reason}</p>
      <div className="dv-comparison-screens">
        {[
          {
            device: run.source,
            png: images?.sourcePng,
            total: difference.sourceTotal,
          },
          ...(run.target
            ? [
                {
                  device: run.target,
                  png: images?.targetPng,
                  total: difference.targetTotal,
                },
              ]
            : []),
        ].map(({ device, png, total }) => (
          <figure key={deviceKey(device)}>
            <figcaption title={`${device.hostId} · ${device.deviceId}`}>
              {device.name}
              {showIdentity && <p className="dv-muted">{device.appId}</p>}
              {total && <strong>{total}</strong>}
            </figcaption>
            {png ? (
              <img
                src={`data:image/png;base64,${png}`}
                alt={`${device.name} at the first difference`}
              />
            ) : (
              <p className="dv-muted">{loading ? "Loading evidence…" : "Screenshot unavailable"}</p>
            )}
          </figure>
        ))}
      </div>
      {images?.unverified && <p className="dv-muted">Saved before integrity checks</p>}
      {images?.unavailableReason && <p className="dv-muted">{images.unavailableReason}</p>}
      {retry && (
        <button type="button" className="dv-link" onClick={retry}>
          Retry loading screenshots
        </button>
      )}
    </section>
  );
}
