import type { ResourceTelemetrySnapshot } from "@tabs/contracts";
import {
  ActivityIcon,
  CpuIcon,
  MemoryStickIcon,
  GitBranchIcon,
  ChevronRightIcon,
} from "lucide-react";
import { formatBytes, formatRate, safeIsoString } from "./ResourceTelemetryDiagnostics";
import type { DiagnosticsTabId } from "./DiagnosticsSettings";
import "./diagnostics.css";

export function DiagnosticsOverview({
  snapshot,
  onNavigateTab,
}: {
  snapshot: ResourceTelemetrySnapshot | null;
  onNavigateTab: (tab: DiagnosticsTabId) => void;
}) {
  const total = snapshot?.groups.allT3;
  const cards = [
    {
      label: "Tabs CPU",
      value: total ? `${total.currentCpuPercent.toFixed(1)}%` : "Unavailable",
      detail: "Across monitored processes",
      icon: CpuIcon,
      tab: "timeline" as const,
    },
    {
      label: "Process memory",
      value: total ? formatBytes(total.currentRssBytes) : "Unavailable",
      detail: "Resident memory, not system RAM",
      icon: MemoryStickIcon,
      tab: "timeline" as const,
    },
    {
      label: "Processes",
      value: total ? String(total.processCount) : "Unavailable",
      detail: "Inspect the process tree",
      icon: GitBranchIcon,
      tab: "process-tree" as const,
    },
  ];
  return (
    <section className="diagnostics-overview" aria-label="Measured Tabs resources">
      <div className="diagnostics-sample">
        <span className="flex items-center gap-2">
          <ActivityIcon size={14} aria-hidden />
          {snapshot
            ? `Collector: ${snapshot.health.native.status}`
            : "Waiting for a resource sample"}
        </span>
        <span>
          {snapshot
            ? `Sampled ${new Date(safeIsoString(snapshot.readAt) ?? "").toLocaleTimeString()}`
            : "Refresh to retry"}
        </span>
      </div>
      <div className="diagnostics-metrics">
        {cards.map(({ label, value, detail, icon: Icon, tab }) => (
          <button
            type="button"
            key={label}
            onClick={() => onNavigateTab(tab)}
            aria-label={`Inspect ${label}`}
          >
            <span className="diagnostics-metric-label">
              <Icon size={15} aria-hidden />
              {label}
              <ChevronRightIcon size={14} aria-hidden />
            </span>
            <strong>{value}</strong>
            <span>{detail}</span>
          </button>
        ))}
      </div>
      {snapshot ? (
        <div className="diagnostics-components">
          <div className="diagnostics-component-head">
            <h3>Where resources go</h3>
            <span>CPU · memory · I/O per second</span>
          </div>
          <div className="diagnostics-component-rows">
            {(
              [
                ["Server & agents", snapshot.groups.backend],
                ["Desktop", snapshot.groups.electron],
                ["Collector", snapshot.groups.monitor],
              ] as const
            ).map(([label, group]) => (
              <div key={label}>
                <span>{label}</span>
                <span>{group.currentCpuPercent.toFixed(1)}%</span>
                <span>{formatBytes(group.currentRssBytes)}</span>
                <span>{formatRate(group.ioReadBytesPerSecond + group.ioWriteBytesPerSecond)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="diagnostics-muted">
          Measured resources appear when the collector is available.
        </p>
      )}
    </section>
  );
}
