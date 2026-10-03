import type {
  BackgroundBooleanState,
  HostPowerSnapshot,
  ResourceAttributionEntry,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryIoSemantics,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetrySnapshot,
  ResourceTelemetrySourceHealth,
  ResourceTelemetrySourceStatus,
  ServerProcessSignal,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BatteryIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  MemoryStickIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../../timestampFormat";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./SettingsLayout";
import {
  resourceHistoryBarHeight,
  resourceHistoryCpuScaleMax,
  visibleResourceTelemetryProcesses,
} from "./ResourceTelemetryDiagnostics.logic";

export const HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 15_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 30_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 2 * 60_000 },
] as const;

export function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

export function formatCpuTime(valueMs: number): string {
  const seconds = valueMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

export function formatDurationMicros(value: number): string {
  if (value < 1_000) return `${Math.round(value)} µs`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(2)} ms`;
  return `${(value / 1_000_000).toFixed(2)} s`;
}

export function formatSampleInterval(valueMs: number): string {
  if (valueMs < 1_000) return `${Math.max(0, Math.round(valueMs))} ms`;
  const seconds = valueMs / 1_000;
  return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${
    seconds === 1 ? "second" : "seconds"
  }`;
}

export function processIdentityKey(process: ResourceTelemetryProcess): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

export function processSummaryIdentityKey(process: ResourceTelemetryProcessSummary): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

export function formatProcessName(
  process: Pick<ResourceTelemetryProcess, "command" | "name">,
): string {
  if (process.name.trim()) return process.name;
  const firstToken = process.command.trim().split(/\s+/)[0] ?? process.command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized;
}

export function categoryLabel(category: ResourceTelemetryProcessCategory): string {
  switch (category) {
    case "server":
      return "Server";
    case "server-child":
      return "Backend child";
    case "provider-root":
      return "Provider";
    case "terminal-root":
      return "Terminal";
    case "electron-main":
      return "Electron main";
    case "electron-renderer":
      return "Renderer";
    case "electron-gpu":
      return "GPU";
    case "electron-utility":
      return "Electron utility";
    case "resource-monitor":
      return "Monitor";
    case "unknown-t3":
      return "Tabs process";
  }
}

export function categoryDotClass(category: ResourceTelemetryProcessCategory): string {
  if (category === "resource-monitor") return "bg-amber-500";
  if (category.startsWith("electron-")) return "bg-sky-500";
  if (category === "server") return "bg-violet-500";
  return "bg-emerald-500";
}

export function ioSemanticsLabel(semantics: ResourceTelemetryIoSemantics): string {
  switch (semantics) {
    case "storage":
      return "Storage bytes";
    case "logical":
      return "Logical bytes";
    case "all-io":
      return "All I/O bytes";
    case "unavailable":
      return "Unavailable";
  }
}

export function booleanStateLabel(
  value: BackgroundBooleanState,
  labels: { readonly true: string; readonly false: string },
): string {
  if (value === "true") return labels.true;
  if (value === "false") return labels.false;
  return "Unknown";
}

export function SourceStatusBadge({
  label,
  status,
  presentation,
}: {
  label: string;
  status: ResourceTelemetrySourceStatus;
  presentation?: { readonly label: string; readonly tone: "neutral" } | undefined;
}) {
  const isHealthy = status === "healthy";
  const isDegraded = status === "degraded" || status === "starting";
  const isNeutral = presentation?.tone === "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
        isNeutral && "border-border/70 bg-muted/45 text-muted-foreground",
        !isNeutral &&
          isHealthy &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        !isNeutral &&
          isDegraded &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        !isNeutral &&
          !isHealthy &&
          !isDegraded &&
          "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isNeutral && "bg-muted-foreground/55",
          !isNeutral && isHealthy && "bg-emerald-500",
          !isNeutral && isDegraded && "bg-amber-500",
          !isNeutral && !isHealthy && !isDegraded && "bg-destructive",
        )}
      />
      {label} {presentation?.label ?? status}
    </span>
  );
}

export function safeIsoString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    if ("epochMilliseconds" in value && typeof (value as any).epochMilliseconds === "number") {
      const millis = (value as any).epochMilliseconds;
      if (!Number.isFinite(millis)) return null;
      const d = new Date(millis);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if ("epochMillis" in value && typeof (value as any).epochMillis === "number") {
      const millis = (value as any).epochMillis;
      if (!Number.isFinite(millis)) return null;
      const d = new Date(millis);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    try {
      if (DateTime.isDateTime(value as any)) {
        const millis = (value as any).epochMilliseconds;
        if (typeof millis === "number" && Number.isFinite(millis)) {
          const d = new Date(millis);
          return isNaN(d.getTime()) ? null : d.toISOString();
        }
      }
    } catch {}
    try {
      const d = new Date(value as any);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {}
  }
  return null;
}

export function LastSampleLabel({
  sampledAt,
}: {
  sampledAt: DateTime.Utc | string | number | null | undefined;
}) {
  const iso = safeIsoString(sampledAt);
  if (!iso) {
    return <span className="text-[11px] text-muted-foreground/55">Waiting for sample</span>;
  }
  const relative = formatRelativeTime(iso);
  if (!relative) {
    return <span className="text-[11px] text-muted-foreground/55">Waiting for sample</span>;
  }
  return (
    <span className="text-[11px] text-muted-foreground/60">
      Updated <span className="font-mono tabular-nums">{relative.value}</span>
      {relative.suffix ? ` ${relative.suffix}` : ""}
    </span>
  );
}

export function IconStat({
  icon,
  label,
  value,
  detail,
  tone = "default",
  barPercent,
  barColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: "default" | "warning" | "danger";
  barPercent?: number | undefined;
  barColor?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-3.5 shadow-xs/5 transition-all duration-200 hover:border-border hover:shadow-xs",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      )}
    >
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80">
          <span className="shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground/80">
            {icon}
          </span>
          <span className="leading-tight">{label}</span>
        </div>
        <div
          className={cn(
            "mt-2 font-mono text-xl sm:text-2xl font-bold tracking-tight tabular-nums text-foreground",
            tone === "warning" && "text-amber-600 dark:text-amber-400",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </div>
        {detail ? (
          <div className="mt-1 text-[11px] leading-tight text-muted-foreground/70">{detail}</div>
        ) : null}
      </div>
      {barPercent != null ? (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted/60">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              barColor ?? "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AggregateCard({
  label,
  accentClass,
  aggregate,
}: {
  label: string;
  accentClass: string;
  aggregate: ResourceTelemetryAggregate;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-4 shadow-xs/5 transition-all duration-200 hover:border-border hover:shadow-xs",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", accentClass)} />
          <div className="text-[13px] font-semibold text-foreground tracking-tight">{label}</div>
        </div>
        <div className="rounded-full bg-muted/60 border border-border/40 px-2 py-0.5 font-mono text-[9.5px] font-medium tabular-nums text-muted-foreground">
          {aggregate.processCount} {aggregate.processCount === 1 ? "proc" : "procs"}
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <MetricPair label="CPU" value={`${aggregate.currentCpuPercent.toFixed(1)}%`} />
        <MetricPair label="Memory" value={formatBytes(aggregate.currentRssBytes)} />
        <MetricPair label="Read" value={formatRate(aggregate.ioReadBytesPerSecond)} />
        <MetricPair label="Write" value={formatRate(aggregate.ioWriteBytesPerSecond)} />
      </div>
    </div>
  );
}

export function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/45">
        {label}
      </div>
      <div className="truncate font-mono text-xs font-medium tabular-nums text-foreground/90">
        {value}
      </div>
    </div>
  );
}

export function HealthSource({
  label,
  health,
}: {
  label: string;
  health: ResourceTelemetrySourceHealth;
}) {
  const expectedInBrowser =
    health.status === "unavailable" &&
    Option.exists(health.lastError, (error) => error.includes("'web' mode"));
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/50 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground/65">
          {expectedInBrowser
            ? "Available when this page runs inside the desktop app."
            : Option.match(health.lastError, {
                onNone: () => "No reported errors",
                onSome: (error) => error,
              })}
        </div>
      </div>
      <SourceStatusBadge
        label=""
        status={health.status}
        presentation={
          expectedInBrowser
            ? {
                label: "Desktop only",
                tone: "neutral",
              }
            : undefined
        }
      />
    </div>
  );
}

export function DetailRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/50 py-2.5 first:border-t-0">
      <span className="text-[11px] text-muted-foreground/75">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-mono text-[11px] tabular-nums text-foreground/85",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function HistoryWindowSelector({
  selectedWindowMs,
  onSelect,
}: {
  selectedWindowMs: number;
  onSelect: (windowMs: number) => void;
}) {
  return (
    <div
      className="tabs-segmented inline-flex items-center select-none"
      role="group"
      aria-label="History window"
    >
      {HISTORY_WINDOWS.map((option) => (
        <button
          key={option.windowMs}
          type="button"
          onClick={() => onSelect(option.windowMs)}
          aria-pressed={selectedWindowMs === option.windowMs}
          className={cn(
            "font-semibold rounded-md transition-all px-2.5 py-1 text-xs cursor-pointer",
            selectedWindowMs === option.windowMs
              ? "bg-background text-foreground shadow-xs border border-foreground/20 dark:bg-accent"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<ResourceTelemetryHistoryBucket>;
}) {
  const maxCpu = resourceHistoryCpuScaleMax(buckets);
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));

  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground/65">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-foreground/70" /> CPU average
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-sky-500/70" /> I/O reads
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-amber-500/80" /> I/O writes
        </span>
      </div>
      <div className="flex h-32 items-end gap-1 overflow-hidden rounded-lg border border-border/40 bg-muted/10 px-2 pt-3 pb-2">
        {buckets.map((bucket, index) => {
          const cpuHeight = resourceHistoryBarHeight({
            value: bucket.avgCpuPercent,
            max: maxCpu,
            minimumVisiblePercent: 2,
          });
          const readHeight = resourceHistoryBarHeight({
            value: bucket.ioReadBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          const writeHeight = resourceHistoryBarHeight({
            value: bucket.ioWriteBytes,
            max: maxIo,
            minimumVisiblePercent: 1,
          });
          return (
            <Tooltip key={safeIsoString(bucket.startedAt) ?? index}>
              <TooltipTrigger
                render={
                  <div className="grid h-full min-w-1 flex-1 grid-cols-3 items-end gap-px">
                    <span
                      className="block rounded-t-xs bg-foreground/65"
                      style={{ height: `${cpuHeight}%` }}
                    />
                    <span
                      className="block rounded-t-xs bg-sky-500/70"
                      style={{ height: `${readHeight}%` }}
                    />
                    <span
                      className="block rounded-t-xs bg-amber-500/80"
                      style={{ height: `${writeHeight}%` }}
                    />
                  </div>
                }
              />
              <TooltipPopup side="top" className="space-y-0.5 text-left font-mono text-xs">
                <div>CPU avg {bucket.avgCpuPercent.toFixed(1)}%</div>
                <div>CPU peak {bucket.maxCpuPercent.toFixed(1)}%</div>
                <div>Read {formatBytes(bucket.ioReadBytes)}</div>
                <div>Write {formatBytes(bucket.ioWriteBytes)}</div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function ProcessTreeName({
  process,
  collapsed,
  onToggle,
}: {
  process: ResourceTelemetryProcess;
  collapsed: boolean;
  onToggle: (process: ResourceTelemetryProcess) => void;
}) {
  const name = formatProcessName(process);
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 7) * 12}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(process)}
          className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        >
          <ChevronIcon className="size-3.5" />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <span className={cn("size-1.5 rounded-full", categoryDotClass(process.category))} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(520px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px]"
        >
          {process.command || process.name}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function ProcessActions({
  process,
  onSignal,
}: {
  process: ResourceTelemetryProcess;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-1.5 shrink-0 whitespace-nowrap">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="cursor-pointer rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground/80 hover:border-border hover:bg-muted hover:text-foreground active:scale-95 transition-all"
              onClick={() => onSignal(process, "SIGINT")}
            >
              INT
            </button>
          }
        />
        <TooltipPopup side="top">
          Send SIGINT (Interrupt) to {process.name || `PID ${process.identity.pid}`}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="cursor-pointer rounded border border-destructive/25 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive hover:border-destructive/40 hover:bg-destructive/20 active:scale-95 transition-all"
              onClick={() => onSignal(process, "SIGKILL")}
            >
              KILL
            </button>
          }
        />
        <TooltipPopup side="top">
          Terminate process {process.name ? `"${process.name}"` : ""} ({process.identity.pid}) with
          SIGKILL
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function ProcessTable({
  processes,
  onSignal,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcess>;
  onSignal: (process: ResourceTelemetryProcess, signal: ServerProcessSignal) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(
    () => visibleResourceTelemetryProcesses(processes, collapsed),
    [collapsed, processes],
  );

  const toggle = useCallback((process: ResourceTelemetryProcess) => {
    const key = processIdentityKey(process);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <ScrollArea scrollFade className="w-full max-w-full">
      <table className="w-full min-w-[980px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[20%]" />
          <col className="w-[10%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
          <col className="w-[7%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">Process</th>
            <th className="px-3 py-2 font-semibold">Category</th>
            <th className="px-3 py-2 text-right font-semibold">CPU</th>
            <th className="px-3 py-2 text-right font-semibold">CPU Time</th>
            <th className="px-3 py-2 text-right font-semibold">Memory</th>
            <th className="px-3 py-2 text-right font-semibold">Read/s</th>
            <th className="px-3 py-2 text-right font-semibold">Write/s</th>
            <th className="px-3 py-2 text-right font-semibold">Read Total</th>
            <th className="px-3 py-2 text-right font-semibold">Write Total</th>
            <th className="px-3 py-2 text-right font-semibold">PID</th>
            <th className="px-2 py-2 text-right font-semibold sm:pr-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                Waiting for the process monitor.
              </td>
            </tr>
          ) : null}
          {visible.map((process) => (
            <tr key={processIdentityKey(process)} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2 sm:pl-5">
                <ProcessTreeName
                  process={process}
                  collapsed={collapsed.has(processIdentityKey(process))}
                  onToggle={toggle}
                />
              </td>
              <td className="truncate px-3 py-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-0.5 text-[10px] font-medium text-foreground/80">
                  <span
                    className={cn("size-1.5 rounded-full", categoryDotClass(process.category))}
                  />
                  {categoryLabel(process.category)}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {process.cpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {formatCpuTime(process.cpuTimeMs)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {formatBytes(process.residentBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-sky-700 dark:text-sky-300">
                {formatRate(process.ioReadBytesPerSecond)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-amber-700 dark:text-amber-300">
                {formatRate(process.ioWriteBytesPerSecond)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                {formatBytes(process.ioReadBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger render={<span>{formatBytes(process.ioWriteBytes)}</span>} />
                  <TooltipPopup side="top">{ioSemanticsLabel(process.ioSemantics)}</TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                {process.identity.pid}
              </td>
              <td className="px-2 py-2 text-right sm:pr-4 whitespace-nowrap">
                <ProcessActions process={process} onSignal={onSignal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

export function HistoryProcessTable({
  processes,
}: {
  processes: ReadonlyArray<ResourceTelemetryProcessSummary>;
}) {
  return (
    <ScrollArea scrollFade className="max-h-[28rem] w-full max-w-full border-t border-border/60">
      <table className="w-full min-w-[960px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[11%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">Process</th>
            <th className="px-3 py-2 font-semibold">Category</th>
            <th className="px-3 py-2 text-right font-semibold">CPU Time</th>
            <th className="px-3 py-2 text-right font-semibold">Peak CPU</th>
            <th className="px-3 py-2 text-right font-semibold">Peak Mem</th>
            <th className="px-3 py-2 text-right font-semibold">Read</th>
            <th className="px-3 py-2 text-right font-semibold">Write</th>
            <th className="px-3 py-2 text-right font-semibold">Samples</th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">PID</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {processes.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                No retained process samples in this window.
              </td>
            </tr>
          ) : null}
          {processes.map((process) => (
            <tr
              key={processSummaryIdentityKey(process)}
              className="hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-2 sm:pl-5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="block truncate font-medium text-foreground">
                        {process.name || process.command}
                      </span>
                    }
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(520px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px]"
                  >
                    {process.command || process.name}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="truncate px-3 py-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-0.5 text-[10px] font-medium text-foreground/80">
                  <span
                    className={cn("size-1.5 rounded-full", categoryDotClass(process.category))}
                  />
                  {categoryLabel(process.category)}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {formatCpuTime(process.cpuTimeMs)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {process.maxCpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {formatBytes(process.peakRssBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-sky-700 dark:text-sky-300">
                {formatBytes(process.ioReadBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-amber-700 dark:text-amber-300">
                {formatBytes(process.ioWriteBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground">
                {process.sampleCount}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-muted-foreground sm:pr-5">
                {process.identity.pid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

export function AttributionTable({
  entries,
}: {
  entries: ReadonlyArray<ResourceAttributionEntry>;
}) {
  return (
    <div className="overflow-x-auto border-t border-border/60">
      <table className="w-full min-w-[720px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[28%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">Component</th>
            <th className="px-3 py-2 font-semibold">Operation</th>
            <th className="px-3 py-2 text-right font-semibold">Logical Read</th>
            <th className="px-3 py-2 text-right font-semibold">Logical Write</th>
            <th className="px-3 py-2 text-right font-semibold">Count</th>
            <th className="px-3 py-2 text-right font-semibold sm:pr-5">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-5 text-xs text-muted-foreground sm:px-5">
                No instrumented application I/O has been recorded yet.
              </td>
            </tr>
          ) : null}
          {entries.map((entry) => (
            <tr
              key={`${entry.component}:${entry.operation}`}
              className="hover:bg-muted/30 transition-colors"
            >
              <td className="truncate px-4 py-2 font-medium text-foreground sm:pl-5">
                {entry.component}
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{entry.operation}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-sky-700 dark:text-sky-300">
                {formatBytes(entry.logicalReadBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                {formatBytes(entry.logicalWriteBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{entry.count}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                {(entry.durationMs / 1_000).toFixed(2)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourceMonitorHeaderSection({
  snapshot,
  isRefreshing,
  onRefresh,
}: {
  snapshot: ResourceTelemetrySnapshot | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const allT3 = snapshot?.groups.allT3;
  const speedLimit = snapshot ? Option.getOrNull(snapshot.speedLimitPercent) : null;

  return (
    <SettingsSection
      title="Resource monitor"
      description="Live native counters for the server, providers, terminals, desktop processes, and monitor overhead."
      headerAction={
        <div className="flex items-center gap-2">
          {snapshot ? (
            <SourceStatusBadge label="Native" status={snapshot.health.native.status} />
          ) : null}
          <LastSampleLabel sampledAt={snapshot?.readAt ?? null} />
          <Button
            size="xs"
            variant="ghost"
            disabled={isRefreshing}
            onClick={onRefresh}
            aria-label="Refresh resource telemetry"
          >
            <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {/* Footprint sampling indicator strip */}
        <div className="flex flex-col gap-2.5 rounded-2xl border border-border/50 bg-card/60 backdrop-blur-xs px-4 py-3 sm:flex-row sm:items-center sm:justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-foreground tracking-tight">
              Tabs System Footprint
            </span>
            <span className="rounded-full bg-muted/70 border border-border/40 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              Live telemetry
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Sampling every{" "}
              <span className="font-mono font-medium text-foreground/80">
                {snapshot ? formatSampleInterval(snapshot.sampleIntervalMs) : "..."}
              </span>
            </span>
            {snapshot ? (
              <SourceStatusBadge label="Native" status={snapshot.health.native.status} />
            ) : null}
          </div>
        </div>

        {/* 6-card stat grid: 2 rows of 3 cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          <IconStat
            icon={<CpuIcon className="size-3.5" />}
            label="Current CPU"
            value={allT3 ? `${allT3.currentCpuPercent.toFixed(1)}%` : "..."}
            detail={allT3 ? `${formatCpuTime(allT3.cpuTimeMs)} observed CPU` : undefined}
            barPercent={allT3 ? Math.min(100, allT3.currentCpuPercent) : 0}
            barColor="bg-sky-500"
          />
          <IconStat
            icon={<MemoryStickIcon className="size-3.5" />}
            label="Resident memory"
            value={allT3 ? formatBytes(allT3.currentRssBytes) : "..."}
            detail={allT3 ? `${formatBytes(allT3.peakRssBytes)} peak` : undefined}
            barPercent={
              allT3
                ? Math.min(100, (allT3.currentRssBytes / Math.max(1, allT3.peakRssBytes)) * 100)
                : 0
            }
            barColor="bg-emerald-500"
          />
          <IconStat
            icon={<ActivityIcon className="size-3.5" />}
            label="Process count"
            value={allT3 ? String(allT3.processCount) : "..."}
            detail={allT3 ? `${allT3.processStarts} st · ${allT3.processExits} ex` : undefined}
            barPercent={allT3 ? Math.min(100, allT3.processCount * 10) : 0}
            barColor="bg-indigo-500"
          />
          <IconStat
            icon={<HardDriveIcon className="size-3.5" />}
            label="Read throughput"
            value={allT3 ? formatRate(allT3.ioReadBytesPerSecond) : "..."}
            detail={allT3 ? `${formatBytes(allT3.ioReadBytes)} total` : undefined}
            barPercent={
              allT3 ? Math.min(100, (allT3.ioReadBytesPerSecond / (1024 * 1024)) * 100) : 0
            }
            barColor="bg-teal-500"
          />
          <IconStat
            icon={<DatabaseIcon className="size-3.5" />}
            label="Write throughput"
            value={allT3 ? formatRate(allT3.ioWriteBytesPerSecond) : "..."}
            detail={allT3 ? `${formatBytes(allT3.ioWriteBytes)} total` : undefined}
            tone={
              allT3 && allT3.ioWriteBytesPerSecond >= 10 * 1_024 * 1_024
                ? "danger"
                : allT3 && allT3.ioWriteBytesPerSecond >= 1_024 * 1_024
                  ? "warning"
                  : "default"
            }
            barPercent={
              allT3 ? Math.min(100, (allT3.ioWriteBytesPerSecond / (1024 * 1024)) * 100) : 0
            }
            barColor="bg-amber-500"
          />
          <IconStat
            icon={<GaugeIcon className="size-3.5" />}
            label="CPU limit"
            value={snapshot ? (speedLimit === null ? "100%" : `${speedLimit.toFixed(0)}%`) : "..."}
            detail={snapshot ? `${snapshot.power.thermalState} thermal` : undefined}
            tone={speedLimit !== null && speedLimit < 80 ? "warning" : "default"}
            barPercent={speedLimit ?? 100}
            barColor={speedLimit !== null && speedLimit < 80 ? "bg-amber-500" : "bg-emerald-500"}
          />
        </div>

        {/* 3 category breakdown cards */}
        {snapshot ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1">
            <AggregateCard
              label="Backend + agents"
              accentClass="bg-emerald-500"
              aggregate={snapshot.groups.backend}
            />
            <AggregateCard
              label="Desktop"
              accentClass="bg-sky-500"
              aggregate={snapshot.groups.electron}
            />
            <AggregateCard
              label="Monitor overhead"
              accentClass="bg-amber-500"
              aggregate={snapshot.groups.monitor}
            />
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

export function HostAndCollectionSection({
  snapshot,
  isRetrying,
  onRetry,
}: {
  snapshot: ResourceTelemetrySnapshot | null;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const hasHostPowerSignal =
    snapshot !== null &&
    (snapshot.power.onBattery !== "unknown" ||
      snapshot.power.lowPowerMode !== "unknown" ||
      snapshot.power.idle !== "unknown" ||
      snapshot.power.locked !== "unknown" ||
      snapshot.power.thermalState !== "unknown");

  return (
    <SettingsSection
      title="Host & collection"
      description="Power states, idle metrics, and collector status."
      headerAction={
        <Button size="xs" variant="outline" disabled={isRetrying} onClick={onRetry}>
          <RefreshCwIcon className={cn("mr-1 size-3", isRetrying && "animate-spin")} />
          Retry monitor
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        {/* Host state card */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-4 shadow-xs/5 transition-all duration-200",
            "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BatteryIcon className="size-4 text-muted-foreground shrink-0" />
              <span
                className="text-[14px] font-semibold text-foreground tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Host state
              </span>
            </div>
            {snapshot ? (
              <span className="rounded-full bg-muted/60 border border-border/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                macOS Host
              </span>
            ) : null}
          </div>
          {hasHostPowerSignal && snapshot ? (
            <>
              <DetailRow
                label="Power source"
                value={booleanStateLabel(snapshot.power.onBattery, {
                  true: "Battery",
                  false: "External power",
                })}
              />
              <DetailRow
                label="Low power mode"
                value={booleanStateLabel(snapshot.power.lowPowerMode, {
                  true: "Enabled",
                  false: "Disabled",
                })}
              />
              <DetailRow
                label="Idle"
                value={`${booleanStateLabel(snapshot.power.idle, {
                  true: "Idle",
                  false: "Active",
                })}${
                  snapshot.power.idleSeconds === null
                    ? ""
                    : ` · ${Math.round(snapshot.power.idleSeconds)}s`
                }`}
              />
              <DetailRow
                label="Session"
                value={
                  snapshot.power.suspended
                    ? "Suspended"
                    : booleanStateLabel(snapshot.power.locked, {
                        true: "Locked",
                        false: "Unlocked",
                      })
                }
              />
              <DetailRow
                label="Thermal"
                value={snapshot.power.thermalState}
                valueClassName={
                  snapshot.power.thermalState === "serious" ||
                  snapshot.power.thermalState === "critical"
                    ? "text-destructive"
                    : undefined
                }
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-5">
              <div className="text-[13px] font-medium text-foreground">
                Desktop host signals not connected
              </div>
              <p className="mt-1.5 max-w-sm text-[11px] leading-relaxed text-muted-foreground/70">
                Power, idle, lock, and thermal state are supplied by the desktop host. Process
                telemetry remains fully active.
              </p>
            </div>
          )}
        </div>

        {/* Collection health card */}
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-4 shadow-xs/5 transition-all duration-200",
            "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GaugeIcon className="size-4 text-muted-foreground shrink-0" />
              <span
                className="text-[14px] font-semibold text-foreground tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Collection health
              </span>
            </div>
            {snapshot ? (
              <SourceStatusBadge label="" status={snapshot.health.native.status} />
            ) : null}
          </div>
          {snapshot ? (
            <>
              <HealthSource label="Native process monitor" health={snapshot.health.native} />
              <HealthSource label="Electron main process" health={snapshot.health.desktop} />
              <DetailRow
                label="Collection time"
                value={formatDurationMicros(snapshot.health.collectionDurationMicros)}
              />
              <DetailRow
                label="Process scan"
                value={`${snapshot.health.retainedProcessCount}/${snapshot.health.scannedProcessCount} retained`}
              />
              <DetailRow
                label="Inaccessible"
                value={String(snapshot.health.inaccessibleProcessCount)}
                valueClassName={
                  snapshot.health.inaccessibleProcessCount > 0
                    ? "text-amber-600 dark:text-amber-300"
                    : undefined
                }
              />
              <DetailRow
                label="Sidecar"
                value={Option.match(snapshot.health.sidecarVersion, {
                  onNone: () => "Unavailable",
                  onSome: (version) =>
                    `${version}${Option.match(snapshot.health.sidecarPid, {
                      onNone: () => "",
                      onSome: (pid) => ` · PID ${pid}`,
                    })}`,
                })}
              />
              <DetailRow label="Restarts" value={String(snapshot.health.restartCount)} />
            </>
          ) : (
            <div className="py-4 text-xs text-muted-foreground">Waiting for collector health.</div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
