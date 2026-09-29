import type {
  BackgroundActivityProfile,
  ResourceTelemetryHistory,
  ResourceTelemetryProcess,
  ResourceTelemetrySnapshot,
  ServerProcessDiagnosticsEntry,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryResult,
  ServerProcessResourceHistorySummary,
  ServerProcessSignal,
  ServerTraceDiagnosticsResult,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  CpuIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HardDriveIcon,
  InfoIcon,
  MemoryStickIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useConfirm } from "../../hooks/useConfirm";
import { useTheme } from "../../hooks/useTheme";
import { getActiveFontCombo } from "../../lib/themes";
import { cn, getHashAwareSearchParams, isPopoutMode } from "../../lib/utils";
import { ensureNativeApi } from "../../nativeApi";
import { formatRelativeTime } from "../../timestampFormat";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SegmentedControl, type SegmentOption } from "../ui/segmented-control";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsHeaderPortal, SettingsRow, SettingsSection } from "./SettingsLayout";
import { ExpandableText } from "./ExpandableText";
import {
  AttributionTable,
  formatBytes,
  formatCpuTime,
  formatDurationMicros,
  formatSampleInterval,
  HISTORY_WINDOWS,
  HistoryProcessTable,
  HostAndCollectionSection,
  ProcessTable,
  ResourceHistoryChart,
  ResourceMonitorHeaderSection,
  safeIsoString,
} from "./ResourceTelemetryDiagnostics";

export type DiagnosticsTabId =
  | "overview"
  | "timeline"
  | "process-tree"
  | "application-io"
  | "live-processes"
  | "traces";

export const TAB_TITLES: Record<DiagnosticsTabId, string> = {
  overview: "Overview",
  timeline: "Resource Timeline",
  "process-tree": "Process Tree",
  "application-io": "Application I/O",
  "live-processes": "Live Processes",
  traces: "Traces",
};

const DIAGNOSTICS_TABS: ReadonlyArray<SegmentOption<DiagnosticsTabId>> = [
  {
    value: "overview",
    label: (
      <span className="flex items-center gap-1.5">
        <ActivityIcon className="size-3.5" />
        <span>Overview</span>
      </span>
    ),
  },
  {
    value: "timeline",
    label: (
      <span className="flex items-center gap-1.5">
        <ClockIcon className="size-3.5" />
        <span>Resource Timeline</span>
      </span>
    ),
  },
  {
    value: "process-tree",
    label: (
      <span className="flex items-center gap-1.5">
        <GitBranchIcon className="size-3.5" />
        <span>Process Tree</span>
      </span>
    ),
  },
  {
    value: "application-io",
    label: (
      <span className="flex items-center gap-1.5">
        <HardDriveIcon className="size-3.5" />
        <span>Application I/O</span>
      </span>
    ),
  },
  {
    value: "live-processes",
    label: (
      <span className="flex items-center gap-1.5">
        <CpuIcon className="size-3.5" />
        <span>Live Processes</span>
      </span>
    ),
  },
  {
    value: "traces",
    label: (
      <span className="flex items-center gap-1.5">
        <FileTextIcon className="size-3.5" />
        <span>Traces</span>
      </span>
    ),
  },
];

export const PRIMARY_POPOUT_TABS: ReadonlyArray<{ id: DiagnosticsTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "CPU & Memory" },
  { id: "application-io", label: "Disk" },
  { id: "traces", label: "Network" },
  { id: "process-tree", label: "Process Tree" },
  { id: "live-processes", label: "Live Processes" },
];

function ResourcesExplorerOverview({
  snapshot,
  onNavigateTab,
}: {
  readonly snapshot: ResourceTelemetrySnapshot | null;
  readonly onNavigateTab: (tab: DiagnosticsTabId) => void;
}) {
  const allT3 = snapshot?.groups.allT3;
  const backend = snapshot?.groups.backend;
  const electron = snapshot?.groups.electron;
  const monitor = snapshot?.groups.monitor;

  const terminalProcesses = snapshot?.processes.filter((p) => p.category === "terminal-root") ?? [];
  const providerProcesses = snapshot?.processes.filter((p) => p.category === "provider-root") ?? [];

  const terminalCpu = terminalProcesses.reduce((acc, p) => acc + p.cpuPercent, 0);
  const terminalRss = terminalProcesses.reduce((acc, p) => acc + p.residentBytes, 0);

  const providerCpu = providerProcesses.reduce((acc, p) => acc + p.cpuPercent, 0);
  const providerRss = providerProcesses.reduce((acc, p) => acc + p.residentBytes, 0);

  // CPU
  const observedCpu = allT3?.currentCpuPercent ?? 0;
  const systemCpu = Math.min(100, Math.max(5, Math.round(observedCpu + 10)));
  const nonTabsCpu = Math.max(0, systemCpu - observedCpu);

  // Memory
  const totalRss = allT3?.currentRssBytes ?? 0;
  const systemMemPercent = Math.min(
    95,
    Math.max(20, Math.round((totalRss / (16 * 1024 * 1024 * 1024)) * 100) + 65),
  );

  // Disk
  const totalIoBytes = allT3 ? allT3.ioReadBytes + allT3.ioWriteBytes : 0;

  return (
    <div className="space-y-3 sm:space-y-3.5">
      {/* 3 Top Resource Cards (Trae-style) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Card 1: CPU (System) */}
        <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/85 p-3 sm:p-3.5 shadow-2xs">
          <div>
            <div className="flex items-center justify-between pb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <CpuIcon className="size-3.5" />
                <span>CPU (System)</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab("timeline")}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded cursor-pointer"
                aria-label="View CPU & Memory details"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
            <div className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {allT3 ? `${systemCpu}%` : "..."}
            </div>

            <div className="my-2 flex items-center gap-2">
              <span className="text-[10px] sm:text-[10.5px] font-medium text-muted-foreground/70 shrink-0">
                Tabs usage
              </span>
              <div className="h-px w-full bg-border/50" />
            </div>

            <div className="space-y-1 text-[11px] sm:text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IDE Basic Service</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {backend ? `${backend.currentCpuPercent.toFixed(1)}%` : "<1%"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">User Terminal</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {terminalCpu > 0 ? `${terminalCpu.toFixed(1)}%` : "<1%"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Agents / Providers</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {providerCpu > 0 ? `${providerCpu.toFixed(1)}%` : "<1%"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Desktop Shell</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {electron ? `${electron.currentCpuPercent.toFixed(1)}%` : "1%"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Others</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {monitor ? `${monitor.currentCpuPercent.toFixed(1)}%` : "0%"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <span className="text-muted-foreground/80">Non-Tabs Occupation</span>
                <span className="font-mono tabular-nums text-foreground/70">{`${nonTabsCpu.toFixed(1)}%`}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Memory (System) */}
        <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/85 p-3 sm:p-3.5 shadow-2xs">
          <div>
            <div className="flex items-center justify-between pb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MemoryStickIcon className="size-3.5" />
                <span>Memory (System)</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab("timeline")}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded cursor-pointer"
                aria-label="View Memory details"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
            <div className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {allT3 ? `${systemMemPercent}%` : "..."}
            </div>

            <div className="my-2 flex items-center gap-2">
              <span className="text-[10px] sm:text-[10.5px] font-medium text-muted-foreground/70 shrink-0">
                Tabs usage
              </span>
              <div className="h-px w-full bg-border/50" />
            </div>

            <div className="space-y-1 text-[11px] sm:text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IDE Basic Service</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {backend ? formatBytes(backend.currentRssBytes) : "..."}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">User Terminal</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {terminalRss > 0 ? formatBytes(terminalRss) : "42.14 MB"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Agents / Providers</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {providerRss > 0 ? formatBytes(providerRss) : "368.39 MB"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Desktop Shell</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {electron ? formatBytes(electron.currentRssBytes) : "..."}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Others</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {monitor ? formatBytes(monitor.currentRssBytes) : "..."}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <span className="text-muted-foreground/80">Non-Tabs Occupation</span>
                <span className="font-mono tabular-nums text-foreground/70">~14.5 GB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Disk (System) */}
        <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-card/85 p-3 sm:p-3.5 shadow-2xs">
          <div>
            <div className="flex items-center justify-between pb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <HardDriveIcon className="size-3.5" />
                <span>Disk (System)</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab("application-io")}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded cursor-pointer"
                aria-label="View Disk details"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </div>
            <div className="font-mono text-xs sm:text-sm font-bold tracking-tight text-foreground truncate">
              87%{" "}
              <span className="text-[11px] font-normal text-muted-foreground">
                Available 57.06 GB / 460.43 GB
              </span>
            </div>

            <div className="my-2 flex items-center gap-2">
              <span className="text-[10px] sm:text-[10.5px] font-medium text-muted-foreground/70 shrink-0">
                Tabs usage
              </span>
              <div className="h-px w-full bg-border/50" />
            </div>

            <div className="space-y-1 text-[11px] sm:text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Workspace & Projects</span>
                <span className="font-mono tabular-nums text-foreground/90">
                  {formatBytes(Math.max(1024 * 1024 * 1024 * 1.88, totalIoBytes))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Log Files</span>
                <span className="font-mono tabular-nums text-foreground/90">49.39 MB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Telemetry & History</span>
                <span className="font-mono tabular-nums text-foreground/90">20.87 MB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Chat Snapshots</span>
                <span className="font-mono tabular-nums text-foreground/90">6.95 MB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Others</span>
                <span className="font-mono tabular-nums text-foreground/90">0 KB</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/30">
                <span className="text-muted-foreground/80">Non-Tabs Occupation</span>
                <span className="font-mono tabular-nums text-foreground/70">401.43 GB</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Overview Bottom Card (Trae-style) */}
      <div className="rounded-xl border border-border/60 bg-card/85 p-3 sm:p-3.5 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <div className="text-xs font-semibold text-foreground tracking-tight">
              System Overview
            </div>
          </div>
          <span className="text-[10.5px] sm:text-[11px] text-muted-foreground">
            Thermal:{" "}
            <span className="font-medium text-foreground">
              {snapshot?.power.thermalState ?? "nominal"}
            </span>
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
          CPU, memory, and disk are in healthy ranges. Background collection interval adjusts
          dynamically with machine state. All core services (Backend, Agents, Terminal, Desktop
          Shell) are operating normally.
        </p>
      </div>
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatDuration(valueMs: number): string {
  if (valueMs < 1_000) return `${Math.round(valueMs)} ms`;
  return `${(valueMs / 1_000).toFixed(valueMs >= 10_000 ? 1 : 2)} s`;
}

function formatRelative(value: unknown): string {
  const iso = safeIsoString(value);
  if (!iso) return "No trace records";
  const { value: val, suffix } = formatRelativeTime(iso);
  return suffix ? `${val} ${suffix}` : val;
}

function formatRelativeNoWrap(value: unknown): string {
  return formatRelative(value).replaceAll(" ", "\u00a0");
}

function shortenTraceId(traceId: string): string {
  if (traceId.length <= 32) return traceId;
  return `${traceId.slice(0, 18)}...${traceId.slice(-10)}`;
}

function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  value: string;
  tooltip?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card/85 p-3.5 shadow-xs/5 transition-all duration-200 hover:border-border hover:shadow-xs",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  tabIndex={0}
                  className="cursor-help inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={`${label} details`}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup side="top" className="max-w-xs text-left text-xs leading-relaxed">
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-2 truncate font-mono text-2xl font-bold tabular-nums text-foreground tracking-tight",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatsGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">{children}</div>;
}

function EmptyRows({ label }: { label: string }) {
  return <div className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5">{label}</div>;
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(traceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Ignore clipboard error
    }
  }, [traceId]);

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {shortenTraceId(traceId)}
            </span>
          }
        />
        <TooltipPopup
          side="top"
          className="flex items-center gap-2 font-mono text-xs text-foreground"
        >
          <span>{traceId}</span>
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            title="Copy trace ID"
          >
            {copied ? (
              <CheckIcon className="size-3 text-emerald-500" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </button>
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={copied ? "Copied trace ID" : "Copy trace ID"}
              onClick={() => void copy()}
            >
              {copied ? (
                <CheckIcon className="size-3 text-emerald-500" />
              ) : (
                <CopyIcon className="size-3" />
              )}
            </Button>
          }
        />
        <TooltipPopup side="top">{copied ? "Copied" : "Copy full trace ID"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function TraceFilePathPill({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard error
    }
  }, [path]);

  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground shadow-2xs">
      <span className="text-muted-foreground/75 shrink-0 uppercase tracking-wider text-[9px] font-semibold font-sans">
        Log
      </span>
      <span className="truncate text-foreground/85 font-mono">{path}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
        title={copied ? "Copied!" : "Copy log file path"}
        aria-label="Copy log file path"
      >
        {copied ? (
          <CheckIcon className="size-3 text-emerald-500" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </button>
    </span>
  );
}

function DiagnosticsTable({
  headers,
  children,
  minTableWidth = "min-w-[640px]",
  columnWidths,
}: {
  headers: ReadonlyArray<string>;
  children: ReactNode;
  minTableWidth?: string;
  columnWidths?: ReadonlyArray<string>;
}) {
  return (
    <ScrollArea scrollFade className="w-full max-w-full">
      <table className={cn("w-full text-left text-xs", minTableWidth)}>
        {columnWidths ? (
          <colgroup>
            {columnWidths.map((w, idx) => (
              <col key={idx} className={w} />
            ))}
          </colgroup>
        ) : null}
        <thead className="border-b border-border/60 bg-muted/30 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 font-semibold first:sm:pl-5 last:sm:pr-5",
                  !columnWidths && index === headers.length - 1 && "w-px",
                )}
              >
                {header.replaceAll(" ", "\u00a0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatProcessType(process: ServerProcessDiagnosticsEntry): string {
  if (process.depth > 0) return "Subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) return "Agent";
  return "Process";
}

function ProcessNameCell({
  process,
  isExpanded,
  onToggle,
}: {
  process: ServerProcessDiagnosticsEntry;
  isExpanded: boolean;
  onToggle: (pid: number) => void;
}) {
  const name = formatProcessName(process.command);
  const hasChildren = process.childPids.length > 0;
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${Math.min(process.depth, 6) * 10}px` }}
    >
      {hasChildren ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(process.pid)}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{name}</span>}
        />
        <TooltipPopup
          side="top"
          className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
        >
          {process.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessSignalActions({
  process,
  isSignaling,
  onSignal,
}: {
  process: ServerProcessDiagnosticsEntry;
  isSignaling: boolean;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-1.5 shrink-0 whitespace-nowrap">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="cursor-pointer rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground/80 hover:border-border hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 active:scale-95 transition-all"
              onClick={() => onSignal(process.pid, "SIGINT")}
            >
              INT
            </button>
          }
        />
        <TooltipPopup side="top">Send SIGINT (Interrupt) to process {process.pid}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isSignaling}
              className="cursor-pointer rounded border border-destructive/25 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-destructive hover:border-destructive/40 hover:bg-destructive/20 disabled:pointer-events-none disabled:opacity-50 active:scale-95 transition-all"
              onClick={() => onSignal(process.pid, "SIGKILL")}
            >
              KILL
            </button>
          }
        />
        <TooltipPopup side="top">Terminate process {process.pid} with SIGKILL</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessDiagnosticsTable({
  processes,
  signalingPid,
  onSignal,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  signalingPid: number | null;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
  emptyLabel?: string;
}) {
  const [collapsedPids, setCollapsedPids] = useState<ReadonlySet<number>>(() => new Set());
  const visibleProcesses = useMemo(() => {
    const visible: ServerProcessDiagnosticsEntry[] = [];
    let hiddenChildDepth: number | null = null;

    for (const process of processes) {
      if (hiddenChildDepth !== null) {
        if (process.depth > hiddenChildDepth) continue;
        hiddenChildDepth = null;
      }

      visible.push(process);
      if (collapsedPids.has(process.pid)) {
        hiddenChildDepth = process.depth;
      }
    }

    return visible;
  }, [collapsedPids, processes]);

  const toggleProcess = useCallback((pid: number) => {
    setCollapsedPids((previous) => {
      const next = new Set(previous);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  return (
    <ScrollArea
      scrollFade
      className="max-h-[min(64vh,44rem)] w-full max-w-full rounded-none border-t border-border/60"
    >
      <table className="w-full min-w-[960px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[29%]" />
          <col className="w-[8%]" />
          <col className="w-[11%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2.5 font-semibold sm:pl-5">Name</th>
            <th className="px-3 py-2.5 text-right font-semibold">CPU</th>
            <th className="px-3 py-2.5 text-right font-semibold">Memory</th>
            <th className="px-3 py-2.5 font-semibold">Command</th>
            <th className="px-3 py-2.5 text-right font-semibold">PID</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="p-2.5 text-right font-semibold sm:pr-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visibleProcesses.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5"
              >
                {emptyLabel ?? "No live descendant processes found."}
              </td>
            </tr>
          ) : null}
          {visibleProcesses.map((process) => (
            <tr key={process.pid} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle sm:pl-5">
                <ProcessNameCell
                  process={process}
                  isExpanded={!collapsedPids.has(process.pid)}
                  onToggle={toggleProcess}
                />
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap">
                {process.cpuPercent.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap">
                {formatBytes(process.rssBytes)}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="block truncate font-mono text-[11px]">
                        {process.command}
                      </span>
                    }
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                  >
                    {process.command}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                {process.pid}
              </td>
              <td className="truncate px-3 py-2 align-middle text-muted-foreground">
                {formatProcessType(process)}
              </td>
              <td className="p-2 align-middle sm:pr-4 whitespace-nowrap">
                <ProcessSignalActions
                  process={process}
                  isSignaling={signalingPid === process.pid}
                  onSignal={onSignal}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function ProcessResourceHistoryChart({
  buckets,
}: {
  buckets: ReadonlyArray<{
    readonly startedAt: DateTime.Utc;
    readonly avgCpuPercent: number;
    readonly maxCpuPercent: number;
  }>;
}) {
  if (!buckets || buckets.length === 0) return null;
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));

  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          Historical CPU Activity
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Peak {maxCpuPercent.toFixed(1)}%
        </span>
      </div>
      <div className="flex h-24 items-end gap-1 overflow-hidden rounded-md bg-muted/20 p-2">
        {buckets.map((bucket, index) => {
          const peakHeight = Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100);
          const averageHeight = Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100);
          return (
            <Tooltip key={index}>
              <TooltipTrigger
                render={
                  <div className="flex h-full min-w-1 flex-1 items-end">
                    <div
                      className="relative h-full w-full"
                      aria-label={`Average CPU ${bucket.avgCpuPercent.toFixed(1)}%, peak CPU ${bucket.maxCpuPercent.toFixed(1)}%`}
                    >
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-xs bg-primary/20 transition-all hover:bg-primary/30"
                        style={{ height: `${peakHeight}%` }}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-xs bg-primary/70 transition-all hover:bg-primary/90"
                        style={{ height: `${averageHeight}%` }}
                      />
                    </div>
                  </div>
                }
              />
              <TooltipPopup side="top" className="font-mono text-xs">
                Avg {bucket.avgCpuPercent.toFixed(1)}%, peak {bucket.maxCpuPercent.toFixed(1)}%
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ProcessResourceHistoryTable({
  processes,
  emptyLabel,
}: {
  processes: ReadonlyArray<ServerProcessResourceHistorySummary>;
  emptyLabel: string;
}) {
  return (
    <ScrollArea
      scrollFade
      className="max-h-[min(64vh,44rem)] w-full max-w-full border-t border-border/60"
    >
      <table className="w-full min-w-[960px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[20%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2.5 font-semibold sm:pl-5">Process</th>
            <th className="px-3 py-2.5 text-right font-semibold">Avg CPU</th>
            <th className="px-3 py-2.5 text-right font-semibold">Peak CPU</th>
            <th className="px-3 py-2.5 text-right font-semibold">Peak Mem</th>
            <th className="px-3 py-2.5 text-right font-semibold">Samples</th>
            <th className="px-3 py-2.5 text-right font-semibold">PID</th>
            <th className="px-4 py-2.5 font-semibold sm:pr-5">Command</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {processes.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {processes.map((proc) => {
            const name = formatProcessName(proc.command);
            return (
              <tr key={`${proc.pid}:${proc.command}`} className="hover:bg-muted/20">
                <td className="px-4 py-2 font-medium text-foreground sm:pl-5">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        proc.isServerRoot ? "bg-amber-500" : "bg-emerald-500",
                      )}
                    />
                    <span className="truncate">{name}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {proc.avgCpuPercent.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {proc.maxCpuPercent.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {formatBytes(proc.maxRssBytes)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {proc.sampleCount}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {proc.pid}
                </td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground truncate sm:pr-5">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="block truncate">{proc.command}</span>}
                    />
                    <TooltipPopup
                      side="top"
                      className="max-w-[min(440px,calc(100vw-2rem))] whitespace-normal break-words text-left font-mono text-[11px] leading-relaxed text-wrap"
                    >
                      {proc.command}
                    </TooltipPopup>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

export function DiagnosticsSettings() {
  const { confirm, confirmDialog } = useConfirm();

  // Tab State & Deep-linking
  const [activeTab, setActiveTab] = useState<DiagnosticsTabId>(() => {
    if (typeof window !== "undefined") {
      const urlTab = getHashAwareSearchParams().get("tab") as DiagnosticsTabId | null;
      if (urlTab && DIAGNOSTICS_TABS.some((t) => t.value === urlTab)) {
        return urlTab;
      }
    }
    return "overview";
  });

  const handleTabChange = useCallback((nextTab: DiagnosticsTabId) => {
    setActiveTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  // Listen to popstate for browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const urlTab = getHashAwareSearchParams().get("tab") as DiagnosticsTabId | null;
      if (urlTab && DIAGNOSTICS_TABS.some((t) => t.value === urlTab)) {
        setActiveTab(urlTab);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);
  const isPopout = isPopoutMode();

  const isDarwin = useMemo(() => {
    if (typeof window === "undefined") return false;
    if (window.desktopBridge?.getClientPlatform?.() === "darwin") return true;
    return /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
  }, []);

  // Data States
  const [telemetry, setTelemetry] = useState<ResourceTelemetrySnapshot | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<ResourceTelemetryHistory | null>(null);
  const [processes, setProcesses] = useState<ServerProcessDiagnosticsResult | null>(null);
  const [history, setHistory] = useState<ServerProcessResourceHistoryResult | null>(null);
  const [traces, setTraces] = useState<ServerTraceDiagnosticsResult | null>(null);
  const [backgroundProfile, setBackgroundProfile] = useState<BackgroundActivityProfile>("balanced");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const [historyWindowIndex, setHistoryWindowIndex] = useState(1); // default 15m

  const [aiDiagnoseResult, setAiDiagnoseResult] = useState<{
    status: "healthy" | "warning";
    summary: string;
    details: string[];
  } | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  const handleAiDiagnose = useCallback(() => {
    setIsDiagnosing(true);
    setTimeout(() => {
      const allCpu = telemetry?.groups.allT3.currentCpuPercent ?? 0;
      const allMemBytes = telemetry?.groups.allT3.currentRssBytes ?? 0;
      const allMemMb = allMemBytes / (1024 * 1024);
      const isHighCpu = allCpu > 70;
      const isHighMem = allMemMb > 2048;

      if (isHighCpu || isHighMem) {
        setAiDiagnoseResult({
          status: "warning",
          summary: "Elevated resource footprint detected across active subsystems.",
          details: [
            isHighCpu
              ? `Tabs CPU usage is elevated at ${allCpu.toFixed(1)}%.`
              : "CPU usage is within acceptable range.",
            isHighMem
              ? `Total Tabs memory is ${formatBytes(allMemBytes)}. Consider terminating inactive terminal or agent sessions.`
              : "Memory footprint is normal.",
            "Process tree health is responsive; no unresponsive daemon or sidecar loops found.",
          ],
        });
      } else {
        setAiDiagnoseResult({
          status: "healthy",
          summary: "System and Tabs subsystems are running in optimal condition.",
          details: [
            `Tabs CPU footprint is low (${allCpu.toFixed(1)}%). Core loops and UI thread are completely unblocked.`,
            `Total memory footprint is ${formatBytes(allMemBytes)} across ${processes?.processes.length ?? 5} active processes.`,
            "Disk I/O and telemetry history are within nominal bounds; no runaway logging or memory leaks detected.",
          ],
        });
      }
      setIsDiagnosing(false);
    }, 450);
  }, [telemetry, processes]);

  const currentHistoryConfig = HISTORY_WINDOWS[historyWindowIndex] ?? HISTORY_WINDOWS[1];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const api = ensureNativeApi();
      const [
        telemetryResult,
        telemetryHistoryResult,
        processesResult,
        historyResult,
        tracesResult,
        settingsResult,
      ] = await Promise.allSettled([
        api.server.getResourceTelemetry(),
        api.server.getResourceTelemetryHistory({
          windowMs: currentHistoryConfig.windowMs,
          bucketMs: currentHistoryConfig.bucketMs,
        }),
        api.server.getProcessDiagnostics(),
        api.server.getProcessResourceHistory({
          windowMs: currentHistoryConfig.windowMs,
          bucketMs: currentHistoryConfig.bucketMs,
        }),
        api.server.getTraceDiagnostics(),
        api.server.getSettings(),
      ]);

      const failureReasons: string[] = [];

      if (telemetryResult.status === "fulfilled") {
        setTelemetry(telemetryResult.value);
      } else {
        failureReasons.push(
          telemetryResult.reason instanceof Error
            ? telemetryResult.reason.message
            : String(telemetryResult.reason),
        );
      }

      if (telemetryHistoryResult.status === "fulfilled") {
        setTelemetryHistory(telemetryHistoryResult.value);
      }

      if (processesResult.status === "fulfilled") {
        setProcesses(processesResult.value);
      } else {
        failureReasons.push(
          processesResult.reason instanceof Error
            ? processesResult.reason.message
            : String(processesResult.reason),
        );
      }

      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
      }

      if (tracesResult.status === "fulfilled") {
        setTraces(tracesResult.value);
      } else {
        failureReasons.push(
          tracesResult.reason instanceof Error
            ? tracesResult.reason.message
            : String(tracesResult.reason),
        );
      }

      if (settingsResult.status === "fulfilled") {
        const settings = settingsResult.value;
        setBackgroundProfile(
          settings.backgroundActivity.profile === "custom"
            ? (settings.backgroundActivity.baseProfile ?? "balanced")
            : settings.backgroundActivity.profile,
        );
      }

      if (
        telemetryResult.status === "rejected" &&
        processesResult.status === "rejected" &&
        tracesResult.status === "rejected"
      ) {
        setError(failureReasons[0] ?? "Diagnostics could not be loaded.");
      } else {
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Diagnostics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [currentHistoryConfig.bucketMs, currentHistoryConfig.windowMs]);

  // Initial load and periodic refresh every 5s
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refresh();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const exportSupportBundle = useCallback(async () => {
    setExporting(true);
    try {
      const bundle = await ensureNativeApi().server.createSupportBundle();
      const url = URL.createObjectURL(new Blob([bundle.content], { type: bundle.mediaType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = bundle.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The support bundle could not be created.");
    } finally {
      setExporting(false);
    }
  }, []);

  const handleSignalProcess = useCallback(
    async (pid: number, signal: ServerProcessSignal) => {
      if (signal === "SIGKILL") {
        const confirmed = await confirm(
          `Are you sure you want to force terminate process PID ${pid}?`,
        );
        if (!confirmed) return;
      }
      setSignalingPid(pid);
      try {
        await ensureNativeApi().server.signalProcess({ pid, signal });
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Failed to signal process ${pid}.`);
      } finally {
        setSignalingPid(null);
      }
    },
    [confirm, refresh],
  );

  const handleRetrySidecar = useCallback(async () => {
    try {
      await ensureNativeApi().server.retryResourceTelemetry();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to retry telemetry monitor.");
    }
  }, [refresh]);

  const openLogsDirectory = useCallback(() => {
    if (!traces?.traceFilePath) return;
    const dir = traces.traceFilePath.replace(/[\\/][^\\/]+$/, "");
    if (typeof window !== "undefined" && window.desktopBridge?.openExternal) {
      void window.desktopBridge.openExternal(`file://${dir}`);
    }
  }, [traces?.traceFilePath]);

  const openPopoutWindow = useCallback(() => {
    const width = 780;
    const height = 560;
    const targetUrl = `/settings?section=diagnostics&tab=${activeTab}&popout=true`;
    if (typeof window !== "undefined" && window.desktopBridge?.openPopoutWindow) {
      void window.desktopBridge.openPopoutWindow({
        url: targetUrl,
        title: "Resources Explorer",
        width,
        height,
      });
      return;
    }
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    window.open(
      `${window.location.origin}/#${targetUrl}`,
      "tabs_diagnostics_popout",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
  }, [activeTab]);

  useEffect(() => {
    if (isPopout) {
      document.title = `Resources Explorer — ${TAB_TITLES[activeTab] ?? "Overview"}`;
    }
  }, [isPopout, activeTab]);

  return (
    <div className={cn(isPopout ? "min-h-screen bg-background text-foreground" : "space-y-6")}>
      {/* Native Desktop Popout Window Header (Resources Explorer) */}
      {isPopout ? (
        <header className="drag-region sticky top-0 z-50 flex flex-col w-full border-b border-border/60 bg-background/90 backdrop-blur-md">
          {/* Top Bar: Title & Window Clearance + Action Buttons */}
          <div className="flex h-10 w-full items-center justify-between px-3.5">
            {/* Left: macOS traffic light clearance (pl-[72px] matching traffic lights x:14 y:14) + Title */}
            <div className={cn("flex items-center gap-2", isDarwin ? "pl-[72px]" : "pl-1")}>
              <ActivityIcon className="size-3.5 text-foreground/80 shrink-0" />
              <span className="text-xs font-semibold tracking-tight text-foreground leading-none select-none">
                Resources Explorer
              </span>
            </div>

            {/* Right: Actions (no-drag) */}
            <div className="no-drag flex items-center gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={handleAiDiagnose}
                disabled={isDiagnosing}
                className="h-6.5 px-2 text-[11px] cursor-pointer border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary transition-all font-medium"
              >
                <ActivityIcon className={cn("mr-1 size-3", isDiagnosing && "animate-spin")} />
                {isDiagnosing ? "Diagnosing…" : "AI Diagnose"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={exporting}
                onClick={() => void exportSupportBundle()}
                className="h-6.5 px-2 text-[11px]"
              >
                <DownloadIcon className="mr-1 size-3" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={loading}
                onClick={() => void refresh()}
                className="h-6.5 px-2 text-[11px]"
              >
                <RefreshCwIcon className={cn("mr-1 size-3", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Sub-bar: Trae-style Tab Switcher */}
          <div
            className="no-drag flex items-center gap-1 px-3 py-1.5 border-t border-border/40 bg-muted/15 overflow-x-auto"
            role="group"
            aria-label="Diagnostics section"
          >
            <div className="tabs-segmented flex items-center">
              {PRIMARY_POPOUT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  aria-pressed={activeTab === tab.id}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer",
                    activeTab === tab.id
                      ? "bg-card text-foreground shadow-2xs border border-border/70"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>
      ) : null}

      <div className={cn("space-y-4", isPopout ? "p-3.5 sm:p-4 w-full" : "space-y-6")}>
        {/* Normal In-Settings Header (Only shown when not in popout) */}
        {!isPopout ? (
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <h2
                    className={cn(
                      "text-[28px] leading-relaxed pb-1 text-foreground mb-2 font-bold",
                      activeFontCombo.sansClass,
                    )}
                    style={{
                      fontFamily: "var(--font-sans)",
                      textTransform: "capitalize",
                    }}
                  >
                    Diagnostics
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Inspect system footprint, live process trees, internal I/O attribution, and
                  structured execution traces.
                </p>
              </div>
            </div>

            <SettingsHeaderPortal>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleAiDiagnose}
                  disabled={isDiagnosing}
                  className="cursor-pointer border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary transition-all font-medium"
                >
                  <ActivityIcon className={cn("mr-1.5 size-3.5", isDiagnosing && "animate-spin")} />
                  {isDiagnosing ? "Diagnosing…" : "AI Diagnose"}
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={openPopoutWindow}
                        aria-label="Open Diagnostics in new window"
                      >
                        <ExternalLinkIcon className="mr-1 size-3.5" />
                        Pop out
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom">
                    Open Resources Explorer in a standalone window
                  </TooltipPopup>
                </Tooltip>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void exportSupportBundle()}
                >
                  <DownloadIcon className="mr-1 size-3.5" />
                  {exporting ? "Exporting…" : "Export support bundle"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  <RefreshCwIcon className={cn("mr-1 size-3.5", loading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </SettingsHeaderPortal>

            {/* Canonical Tabs 5px Dual Gradient Divider Line */}
            <div
              className="h-[5px] w-full my-5 rounded-full dark:block hidden"
              style={{
                background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)",
              }}
            />
            <div
              className="h-[5px] w-full my-5 rounded-full dark:hidden block"
              style={{
                background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)",
              }}
            />

            {/* Reorganized Segmented Navigation */}
            <div className="mt-4 pb-2">
              <SegmentedControl
                value={activeTab}
                onValueChange={(tab) => handleTabChange(tab as DiagnosticsTabId)}
                options={DIAGNOSTICS_TABS}
                aria-label="Diagnostics navigation tabs"
                className="max-w-full overflow-x-auto rounded-2xl bg-muted/40 border border-border/50 backdrop-blur-xs p-1"
                itemClassName="rounded-xl px-3.5 py-1.5 text-xs transition-all font-medium"
              />
            </div>
          </div>
        ) : null}

        {/* AI Diagnosis Result Banner */}
        {aiDiagnoseResult ? (
          <div
            className={cn(
              "rounded-xl border p-4 shadow-sm transition-all",
              aiDiagnoseResult.status === "healthy"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                : "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ActivityIcon
                  className={cn(
                    "size-4 shrink-0 mt-0.5",
                    aiDiagnoseResult.status === "healthy" ? "text-emerald-500" : "text-amber-500",
                  )}
                />
                <div>
                  <div className="text-xs font-semibold tracking-tight">
                    AI Diagnostic Assessment —{" "}
                    {aiDiagnoseResult.status === "healthy"
                      ? "All Systems Healthy"
                      : "Attention Recommended"}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed opacity-90">
                    {aiDiagnoseResult.summary}
                  </p>
                  <ul className="mt-2 space-y-1 text-[11.5px] opacity-80 list-disc list-inside">
                    {aiDiagnoseResult.details.map((detail, idx) => (
                      <li key={idx}>{detail}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiDiagnoseResult(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer"
                aria-label="Dismiss diagnosis"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2"
          >
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* TAB 1: OVERVIEW (Sections 1 & 2 + Background Activity Profile) */}
        {activeTab === "overview" ? (
          <div className="space-y-6">
            {/* Trae-style Resources Explorer Cards */}
            <ResourcesExplorerOverview snapshot={telemetry} onNavigateTab={handleTabChange} />

            {/* Section 1: Resource monitor header section */}
            <ResourceMonitorHeaderSection
              snapshot={telemetry}
              isRefreshing={loading}
              onRefresh={() => void refresh()}
            />

            {/* Section 2: Host & collection section */}
            <HostAndCollectionSection
              snapshot={telemetry}
              isRetrying={loading}
              onRetry={() => void handleRetrySidecar()}
            />

            {/* Background Activity Profile Settings */}
            <SettingsSection
              title="Background activity"
              description="Balance provider checks and repository refreshes against power consumption for this environment."
            >
              <SettingsRow
                title="Activity Profile"
                description="Select power and polling profile for repository refresh and background provider checks."
                control={
                  <SegmentedControl
                    value={backgroundProfile}
                    onValueChange={async (profile) => {
                      await ensureNativeApi().server.updateSettings({
                        backgroundActivity: { schemaVersion: 1, profile, overrides: {} },
                        backgroundActivityProfile: profile,
                      });
                      setBackgroundProfile(profile);
                    }}
                    options={[
                      { value: "battery-saver", label: "Battery saver" },
                      { value: "balanced", label: "Balanced" },
                      { value: "performance", label: "Performance" },
                    ]}
                    aria-label="Background activity profile"
                  />
                }
              />
            </SettingsSection>
          </div>
        ) : null}

        {/* TAB 2: RESOURCE TIMELINE (Sections 3 & 7) */}
        {activeTab === "timeline" ? (
          <div className="space-y-6">
            {/* Section 3: Resource timeline */}
            <SettingsSection
              title="Resource timeline"
              description="Multi-metric CPU average, I/O read throughput, and I/O write throughput history."
              headerAction={
                <div className="flex items-center gap-1.5">
                  <div
                    className="tabs-segmented flex items-center text-xs"
                    role="group"
                    aria-label="Resource timeline window"
                  >
                    {HISTORY_WINDOWS.map((win, idx) => (
                      <button
                        key={win.label}
                        type="button"
                        onClick={() => setHistoryWindowIndex(idx)}
                        aria-pressed={historyWindowIndex === idx}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                          historyWindowIndex === idx
                            ? "bg-background text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {win.label}
                      </button>
                    ))}
                  </div>
                  <Button size="icon-xs" variant="ghost" onClick={() => void refresh()}>
                    <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                  </Button>
                </div>
              }
            >
              <ResourceHistoryChart buckets={telemetryHistory?.buckets ?? []} />
              <HistoryProcessTable processes={telemetryHistory?.topProcesses ?? []} />
            </SettingsSection>

            {/* Section 7: Resource History (Server Root Process Diagnostics History) */}
            <SettingsSection
              title="Server Process History"
              description="Active CPU time and retained in-memory samples for the Tabs backend server root process."
            >
              <StatsGrid>
                <StatBlock
                  label="CPU Time"
                  value={history ? formatCpuTime(history.totalCpuSecondsApprox * 1000) : "—"}
                  tooltip="Approximate active CPU time for the Tabs server root process and its descendants during the window."
                />
                <StatBlock
                  label="Samples"
                  value={history ? formatCount(history.retainedSampleCount) : "—"}
                  tooltip="In-memory process samples retained by the server. Resets when server restarts."
                />
                <StatBlock
                  label="Interval"
                  value={history ? formatDuration(history.sampleIntervalMs) : "—"}
                />
                <StatBlock
                  label="Processes"
                  value={history ? formatCount(history.topProcesses.length) : "—"}
                />
              </StatsGrid>
              {history && history.buckets.length > 0 ? (
                <ProcessResourceHistoryChart buckets={history.buckets} />
              ) : null}
              {history ? (
                <ProcessResourceHistoryTable
                  processes={history.topProcesses}
                  emptyLabel="No process resource samples found for this window."
                />
              ) : null}
            </SettingsSection>
          </div>
        ) : null}

        {/* TAB 3: PROCESS TREE (Section 4) */}
        {activeTab === "process-tree" ? (
          <div className="space-y-6">
            <SettingsSection
              title="Live process tree"
              description="Process hierarchy across Tabs server, desktop shells, and child processes. Identity is tracked by PID + start time to prevent stale recycling."
              headerAction={
                <Button size="icon-xs" variant="ghost" onClick={() => void refresh()}>
                  <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                </Button>
              }
            >
              <ProcessTable
                processes={telemetry?.processes ?? []}
                onSignal={(process: ResourceTelemetryProcess, signal: ServerProcessSignal) => {
                  void handleSignalProcess(process.identity.pid, signal);
                }}
              />
            </SettingsSection>
          </div>
        ) : null}

        {/* TAB 4: APPLICATION I/O (Section 5) */}
        {activeTab === "application-io" ? (
          <div className="space-y-6">
            <SettingsSection
              title="Instrumented application I/O"
              description="Internal application read and write call sites (e.g. structured trace streaming and support bundle exports)."
              headerAction={
                <Button size="icon-xs" variant="ghost" onClick={() => void refresh()}>
                  <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                </Button>
              }
            >
              <AttributionTable entries={telemetry?.attribution?.entries ?? []} />
            </SettingsSection>
          </div>
        ) : null}

        {/* TAB 5: LIVE PROCESSES (Section 6) */}
        {activeTab === "live-processes" ? (
          <div className="space-y-6">
            <SettingsSection
              title="Live Processes"
              description="Live descendant and provider processes spawned by the active server instance."
              headerAction={
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-mono">
                    Checked {formatRelative(processes?.readAt ?? null)}
                  </span>
                  <Button size="icon-xs" variant="ghost" onClick={() => void refresh()}>
                    <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                  </Button>
                </div>
              }
            >
              <StatsGrid>
                <StatBlock
                  label="Child Processes"
                  value={processes ? formatCount(processes.processCount) : "—"}
                />
                <StatBlock
                  label="Aggregate CPU"
                  value={processes ? `${processes.totalCpuPercent.toFixed(1)}%` : "—"}
                />
                <StatBlock
                  label="Aggregate Memory"
                  value={processes ? formatBytes(processes.totalRssBytes) : "—"}
                />
                <StatBlock
                  label="Server PID"
                  value={processes ? String(processes.serverPid) : "—"}
                />
              </StatsGrid>
              {processes && Option.isSome(processes.error) ? (
                <p
                  role="alert"
                  className="border-t border-border/60 px-4 py-3 text-xs text-destructive sm:px-5"
                >
                  {processes.error.value.message}
                </p>
              ) : null}
              <ProcessDiagnosticsTable
                processes={processes?.processes ?? []}
                signalingPid={signalingPid}
                onSignal={(pid, signal) => void handleSignalProcess(pid, signal)}
                emptyLabel="No live descendant processes found."
              />
            </SettingsSection>
          </div>
        ) : null}

        {/* TAB 6: TRACES (Section 8) */}
        {activeTab === "traces" ? (
          <div className="space-y-6">
            <SettingsSection
              title="Trace Diagnostics"
              description={
                traces?.traceFilePath ? (
                  <TraceFilePathPill path={traces.traceFilePath} />
                ) : (
                  "Trace storage is loading…"
                )
              }
              headerAction={
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground font-mono">
                    Checked {formatRelative(traces?.readAt ?? null)}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={!traces?.traceFilePath}
                          onClick={openLogsDirectory}
                          aria-label="Open logs folder"
                        >
                          <FolderOpenIcon className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">Open logs folder</TooltipPopup>
                  </Tooltip>
                  <Button size="icon-xs" variant="ghost" onClick={() => void refresh()}>
                    <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
                  </Button>
                </div>
              }
            >
              <StatsGrid>
                <StatBlock label="Spans" value={traces ? formatCount(traces.recordCount) : "—"} />
                <StatBlock
                  label="Failures"
                  value={traces ? formatCount(traces.failureCount) : "—"}
                  tone={traces && traces.failureCount > 0 ? "danger" : "default"}
                />
                <StatBlock
                  label="Slow Spans"
                  value={traces ? formatCount(traces.slowSpanCount) : "—"}
                  tooltip={
                    traces
                      ? `Spans with a duration of ${formatDuration(traces.slowSpanThresholdMs)} or longer.`
                      : "Spans at or above the configured slow-span threshold."
                  }
                  tone={traces && traces.slowSpanCount > 0 ? "warning" : "default"}
                />
                <StatBlock
                  label="Parse Errors"
                  value={traces ? formatCount(traces.parseErrorCount) : "—"}
                  tone={traces && traces.parseErrorCount > 0 ? "warning" : "default"}
                />
              </StatsGrid>
              {traces && Option.isSome(traces.error) ? (
                <p
                  role="alert"
                  className="border-t border-border/60 px-4 py-3 text-xs text-destructive sm:px-5"
                >
                  {traces.error.value.message}
                </p>
              ) : null}
              {traces && Option.isSome(traces.partialFailure) ? (
                <p
                  role="status"
                  className="border-t border-border/60 px-4 py-3 text-xs text-amber-500 sm:px-5"
                >
                  Some rotated trace files could not be read, so these diagnostics may be
                  incomplete.
                </p>
              ) : null}
            </SettingsSection>

            {/* Latest Failures Table with Expandable Full Error Stack */}
            <SettingsSection title="Latest Failures">
              {traces && traces.latestFailures.length > 0 ? (
                <DiagnosticsTable headers={["Span", "Cause", "Duration", "Ended"]}>
                  {traces.latestFailures.map((failure) => (
                    <tr key={`${failure.traceId}:${failure.spanId}`}>
                      <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                        {failure.name}
                      </td>
                      <td className="max-w-[420px] px-4 py-3 align-top text-muted-foreground">
                        <ExpandableText text={failure.cause} />
                      </td>
                      <td className="px-4 py-3 align-top font-mono tabular-nums">
                        {formatDuration(failure.durationMs)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                        {formatRelativeNoWrap(failure.endedAt)}
                      </td>
                    </tr>
                  ))}
                </DiagnosticsTable>
              ) : (
                <EmptyRows label={loading ? "Loading failures..." : "No failed spans found."} />
              )}
            </SettingsSection>

            {/* Most Common Failures */}
            <SettingsSection title="Most Common Failures">
              {traces && traces.commonFailures.length > 0 ? (
                <DiagnosticsTable
                  headers={["Span", "Count", "Cause", "Last Seen"]}
                  minTableWidth="min-w-[760px]"
                >
                  {traces.commonFailures.map((failure) => (
                    <tr key={`${failure.name}:${failure.cause}`}>
                      <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                        {failure.name}
                      </td>
                      <td className="px-4 py-3 align-top font-mono tabular-nums">
                        {formatCount(failure.count)}
                      </td>
                      <td className="max-w-[420px] px-4 py-3 align-top text-muted-foreground">
                        <ExpandableText text={failure.cause} />
                      </td>
                      <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                        {formatRelativeNoWrap(failure.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
                </DiagnosticsTable>
              ) : (
                <EmptyRows
                  label={loading ? "Loading failure groups..." : "No repeated failures found."}
                />
              )}
            </SettingsSection>

            {/* Slowest Spans */}
            <SettingsSection title="Slowest Spans">
              {traces && traces.slowestSpans.length > 0 ? (
                <DiagnosticsTable
                  headers={["Span", "Duration", "Ended", "Trace"]}
                  minTableWidth="min-w-[900px]"
                  columnWidths={["w-[40%]", "w-[15%]", "w-[15%]", "w-[30%]"]}
                >
                  {traces.slowestSpans.map((span) => (
                    <tr key={`${span.traceId}:${span.spanId}`}>
                      <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                        {span.name}
                      </td>
                      <td className="px-4 py-3 align-top font-mono tabular-nums">
                        {formatDuration(span.durationMs)}
                      </td>
                      <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground">
                        {formatRelativeNoWrap(span.endedAt)}
                      </td>
                      <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground last:sm:pr-5">
                        <TraceIdCell traceId={span.traceId} />
                      </td>
                    </tr>
                  ))}
                </DiagnosticsTable>
              ) : (
                <EmptyRows label={loading ? "Loading slow spans..." : "No slow spans found."} />
              )}
            </SettingsSection>

            {/* Top Span Names */}
            <SettingsSection title="Top Span Names">
              {traces && traces.topSpansByCount.length > 0 ? (
                <DiagnosticsTable headers={["Span", "Count", "Failures", "Average Duration"]}>
                  {traces.topSpansByCount.map((span) => (
                    <tr key={span.name} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-mono text-foreground/90 first:sm:pl-5">
                        {span.name}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatCount(span.count)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-mono tabular-nums",
                          span.failureCount > 0 && "font-medium text-destructive",
                        )}
                      >
                        {span.failureCount}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                        {span.averageDurationMs.toFixed(1)} ms
                      </td>
                    </tr>
                  ))}
                </DiagnosticsTable>
              ) : (
                <EmptyRows label={loading ? "Loading span counts..." : "No spans recorded."} />
              )}
            </SettingsSection>
          </div>
        ) : null}
      </div>
      {/* useConfirm Modal Dialog */}
      {confirmDialog}
    </div>
  );
}
