import { type DockResourceSample, formatDockMemory, formatDockUptime } from "./dockResources";

export function DockSparkline({
  history,
  large = false,
}: {
  history: readonly DockResourceSample[];
  large?: boolean;
}) {
  const end = history.at(-1)?.sampledAt ?? 0;
  let previous: DockResourceSample | undefined;
  const path = history
    .map((sample) => {
      if (sample.cpuPercent === null) {
        previous = undefined;
        return "";
      }
      const x = 2 + ((sample.sampledAt - (end - 60_000)) / 60_000) * 236;
      const y = 46 - (Math.min(100, sample.cpuPercent) / 100) * 42;
      const command = !previous || sample.sampledAt - previous.sampledAt > 10_000 ? "M" : "L";
      previous = sample;
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className={large ? "dock-usage-chart" : "dock-sparkline"}
      viewBox="0 0 240 48"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {large && (
        <>
          <path className="dock-chart-grid" d="M2 4H238 M2 25H238 M2 46H238" />
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function DockResources({
  sample,
  history,
  state,
  running,
}: {
  sample: DockResourceSample | undefined;
  history: readonly DockResourceSample[];
  state: "connecting" | "live" | "unavailable";
  running: boolean;
}) {
  return (
    <section className="dock-resources" aria-label="Process resources">
      <div className="dock-resource-heading">
        <span>Resources</span>
        <span>
          {sample
            ? `${sample.processCount} processes`
            : running
              ? state === "connecting"
                ? "Connecting"
                : "Unavailable"
              : "Not running"}
        </span>
      </div>
      <dl className="dock-resource-values">
        <div title="Share of the execution host's total CPU capacity, including child processes">
          <dt>CPU</dt>
          <dd>{sample?.cpuPercent != null ? `${sample.cpuPercent.toFixed(1)}%` : "—"}</dd>
        </div>
        <div title="Combined resident memory, including shared pages">
          <dt>Memory</dt>
          <dd>{sample ? formatDockMemory(sample.memoryBytes) : "—"}</dd>
        </div>
        <div title="Time since this terminal process started">
          <dt>Uptime</dt>
          <dd>{sample ? formatDockUptime(sample.uptimeMs) : "—"}</dd>
        </div>
      </dl>
      <div className="dock-resource-detail">
        {sample?.memoryPercent != null ? `${sample.memoryPercent.toFixed(1)}% of host RAM · ` : ""}
        Shell + child processes
      </div>
      {sample && (
        <>
          <div className="dock-chart-caption">
            <span>CPU · last 60 seconds</span>
            <span>100%</span>
          </div>
          <DockSparkline history={history} large />
          <div className="dock-chart-caption">
            <span>60s ago</span>
            <span>Now · 0%</span>
          </div>
        </>
      )}
      {!sample && (
        <p className="dock-resource-note">
          {running
            ? "Waiting for a current process sample. CPU and memory appear when monitoring is available."
            : "Start a terminal or run this preset to see its resource usage."}
        </p>
      )}
    </section>
  );
}
