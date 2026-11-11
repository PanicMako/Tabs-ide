import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScriptSuggestion } from "./scriptSuggestions";
import type { ProjectWorkspaceSettings } from "@tabs/contracts/settings";
import {
  CopyIcon,
  ExternalLinkIcon,
  PanelRightIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ScanLineIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  SquareIcon,
  TerminalIcon,
  XIcon,
  SendIcon,
  ListIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Menu, MenuTrigger, MenuPopup } from "../ui/menu";
import { DockUfoIcon } from "../DockUfoIcon";
import { resolvePresetIconElement } from "../ServerPresetFormFields";
import { toastManager } from "../ui/toast";
import { useDockOutput } from "./useDockOutput";
import { assignDockSlot, DEFAULT_DOCK_VIEW, DOCK_LAYOUTS, useDockState } from "./dockState";
import { useDockResources, type DockTelemetryApi } from "./useDockResources";
import { DockResources, DockSparkline } from "./DockResourceInspector";
import { formatDockMemory } from "./dockResources";
import { useConfirm } from "../../hooks/useConfirm";
import { DockLaunchpad } from "./DockLaunchpad";
import "./dock-workspace.css";

export type DockPreset = NonNullable<ProjectWorkspaceSettings["serverPresets"]>[number];
interface Props {
  scope: string;
  projectName: string;
  cwd: string;
  presets: readonly DockPreset[];
  terminalIds: readonly string[];
  runningIds: readonly string[];
  activeTerminalId: string | null;
  threadId: string | null;
  api: DockTelemetryApi | null;
  renderTerminal: (id: string) => ReactNode;
  onRun: (id: string) => void;
  onRestart: (id: string) => void;
  onStop: (id: string) => void;
  onActivate: (id: string) => void;
  onNewTerminal: () => void;
  onCloseAll: () => void;
  onAdd: () => void;
  onManage: (id?: string) => void;
  onDelete?: (id: string) => void;
  onSave: (preset: DockPreset) => void;
  onPreview: (preset: DockPreset) => void;
  onInspectPreview: (preset: DockPreset) => void;
  canInspectPreview: boolean;
  onAddToAgent: (text: string) => Promise<void>;
  /** Run a command once in a fresh Dock terminal. */
  onRunCommand: (command: string) => void;
  /** Append a new preset. */
  onCreatePreset: (preset: DockPreset) => void;
  /** The project's own scripts, for the empty Dock. */
  loadSuggestions?: (() => Promise<ScriptSuggestion[]>) | undefined;
}
const DRAG = "application/x-tabs-dock-preset";
function LayoutGlyph({ layout }: { layout: string }) {
  return (
    <span aria-hidden="true" className={`dock-layout-glyph ${layout}`}>
      {Array.from(
        {
          length: layout === "quad" ? 4 : layout === "main-stack" ? 3 : layout === "focus" ? 1 : 2,
        },
        (_, i) => (
          <i key={i} />
        ),
      )}
    </span>
  );
}
export function DockWorkspace(props: Props) {
  const view = useDockState((state) => state.views[props.scope] ?? DEFAULT_DOCK_VIEW);
  const update = (patch: Partial<typeof view>) =>
    useDockState.getState().update(props.scope, patch);
  const { confirm, confirmDialog } = useConfirm();
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  useEffect(() => {
    setClosedTabs([]);
  }, [props.scope]);
  const available = [
    ...props.presets.map((p) => p.id),
    ...props.terminalIds.filter((id) => !props.presets.some((p) => p.id === id)),
  ];
  const tabIds = available.filter((id) => !closedTabs.includes(id));
  const selectedId =
    view.selected &&
    !closedTabs.includes(view.selected) &&
    (props.presets.some((p) => p.id === view.selected) || props.terminalIds.includes(view.selected))
      ? view.selected
      : ((props.activeTerminalId &&
        !closedTabs.includes(props.activeTerminalId) &&
        props.terminalIds.includes(props.activeTerminalId)
          ? props.activeTerminalId
          : null) ??
        tabIds[0] ??
        null);
  const isEmpty = props.presets.length === 0 && props.terminalIds.length === 0;
  const terminalKey = JSON.stringify(props.terminalIds);
  const renderedTerminals = useMemo(
    () => new Map(props.terminalIds.map((id) => [id, props.renderTerminal(id)])),
    [props.renderTerminal, terminalKey],
  );
  const selected = props.presets.find((p) => p.id === selectedId);
  const output = useDockOutput(props.api, props.threadId, props.terminalIds);
  const resourceRoots = Object.fromEntries(
    props.terminalIds.map((id) => [id, output[id]?.pid ?? null]),
  );
  const resources = useDockResources(props.api, props.threadId, resourceRoots);
  // Live totals across every Dock process, for the header.
  const totals = (() => {
    const samples = Object.values(resources.samples);
    if (samples.length === 0) return null;
    return {
      cpu: samples.reduce((sum, sample) => sum + (sample.cpuPercent ?? 0), 0),
      memory: samples.reduce((sum, sample) => sum + sample.memoryBytes, 0),
    };
  })();
  const selectedSample = selectedId ? resources.samples[selectedId] : undefined;
  const panelId = useId();
  const servicesOpen = view.services ?? true;
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [draft, setDraft] = useState<DockPreset | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const config = DOCK_LAYOUTS.find((item) => item.id === view.layout)!;
  const name = (id: string) =>
    props.presets.find((p) => p.id === id)?.label ??
    (output[id]?.label || `Terminal ${props.terminalIds.indexOf(id) + 1}`);
  const status = (id: string) =>
    output[id]?.error || (output[id]?.exitCode != null && output[id]!.exitCode !== 0)
      ? "error"
      : props.runningIds.includes(id)
        ? "running"
        : props.terminalIds.includes(id)
          ? output[id]?.pid
            ? "shell"
            : "stopped"
          : "ready";
  const choose = (id: string) => {
    setClosedTabs((ids) => ids.filter((closed) => closed !== id));
    setQuery("");
    setErrorsOnly(false);
    update({
      stream: false,
      selected: id,
      ...(view.layout !== "focus" && !props.terminalIds.includes(id)
        ? { layout: "focus" as const }
        : {}),
      slots:
        view.layout === "focus"
          ? assignDockSlot(view.slots, id, 0)
          : view.slots.includes(id)
            ? view.slots
            : assignDockSlot(view.slots, id, Math.max(0, view.slots.indexOf(selectedId))),
    });
    if (props.terminalIds.includes(id)) props.onActivate(id);
  };
  const closeTerminal = async (id: string) => {
    if (!(await confirm(`Close "${name(id)}"? Any commands running in this terminal will stop.`)))
      return;
    setClosedTabs((ids) => [...ids, id]);
    update({
      selected: selectedId === id ? (tabIds.find((other) => other !== id) ?? null) : selectedId,
      slots: view.slots.map((slot) => (slot === id ? null : slot)),
    });
    props.onStop(id);
    requestAnimationFrame(() => {
      const target =
        workspaceRef.current?.querySelector<HTMLButtonElement>(
          '[role="tab"][aria-selected="true"]',
        ) ??
        workspaceRef.current?.querySelector<HTMLButtonElement>('[aria-label="New Dock terminal"]');
      target?.focus();
    });
  };
  const runPreset = (id: string) => {
    setClosedTabs((ids) => ids.filter((closed) => closed !== id));
    props.onRun(id);
  };
  // A preset created with "run" starts once it is part of the saved settings;
  // running earlier would look it up before it exists.
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingRunId || !props.presets.some((preset) => preset.id === pendingRunId)) return;
    setPendingRunId(null);
    runPreset(pendingRunId);
    // runPreset is recreated every render; the preset list is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRunId, props.presets]);
  useEffect(() => {
    const id = props.activeTerminalId;
    if (!id || closedTabs.includes(id) || !props.terminalIds.includes(id)) return;
    const state = useDockState.getState();
    const current = state.views[props.scope] ?? DEFAULT_DOCK_VIEW;
    state.update(props.scope, {
      selected: id,
      slots:
        current.layout === "focus"
          ? assignDockSlot(current.slots, id, 0)
          : current.slots.includes(id)
            ? current.slots
            : assignDockSlot(
                current.slots,
                id,
                Math.max(0, current.slots.indexOf(current.selected)),
              ),
    });
  }, [props.activeTerminalId, props.scope, terminalKey]);
  useEffect(() => {
    setDraft(selected ? { ...selected, commands: [...selected.commands] } : null);
  }, [selected]);
  useEffect(() => {
    if (view.layout === "focus") return;
    const live = props.terminalIds.filter((id) => !closedTabs.includes(id));
    const slots = view.slots.slice(0, config.slots);
    if (live.length >= config.slots && slots.every((id) => id && live.includes(id))) return;
    const layout =
      live.length >= config.slots
        ? config
        : live.length >= 2
          ? DOCK_LAYOUTS.find((item) => item.id === "columns")!
          : DOCK_LAYOUTS[0]!;
    const next = slots.filter((id): id is string => id !== null && live.includes(id));
    for (const id of live) if (!next.includes(id)) next.push(id);
    update({
      layout: layout.id,
      slots: [...next.slice(0, layout.slots), null, null, null, null].slice(0, 4),
    });
  }, [terminalKey, closedTabs, view.layout]);

  const capturedIds = [
    ...new Set([
      ...props.terminalIds,
      ...props.presets.filter((preset) => output[preset.id]).map((preset) => preset.id),
    ]),
  ];
  const logText = view.stream
    ? capturedIds
        .map((id) => ({ id, time: output[id]?.updated ?? 0 }))
        .sort((a, b) => a.time - b.time)
        .map(({ id }) => `--- ${name(id)} ---\n${output[id]?.text ?? ""}`)
        .join("\n")
    : selectedId
      ? (output[selectedId]?.text ?? "")
      : "";
  const lines = logText
    .split("\n")
    .filter(
      (line) =>
        (!query || line.toLowerCase().includes(query.toLowerCase())) &&
        (!errorsOnly || /error|failed|exception|ENOTFOUND/i.test(line)),
    )
    .slice(-1000);
  useEffect(() => {
    if (follow.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logText, query, errorsOnly]);
  const context = () =>
    [
      `Dock · ${selected?.label ?? props.projectName}`,
      `Working directory: ${selected?.cwd || props.cwd}`,
      selected ? `Commands:\n${selected.commands.join("\n")}` : "",
      `Status: ${selectedId ? status(selectedId) : "ready"}`,
      "Recent output (last 120 lines):",
      logText.split("\n").slice(-120).join("\n") || "(no output captured)",
    ]
      .filter(Boolean)
      .join("\n");
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Dock action failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  const place = (id: string, index: number) => {
    if (!available.includes(id) || (view.layout !== "focus" && !props.terminalIds.includes(id)))
      return;
    update({ slots: assignDockSlot(view.slots, id, index), selected: id, stream: false });
    if (props.terminalIds.includes(id)) props.onActivate(id);
  };
  return (
    <div
      ref={workspaceRef}
      className="dock-workspace"
      data-layout={view.layout}
      data-services={servicesOpen || undefined}
      data-inspector={view.inspector || undefined}
    >
      <header className="dock-topbar">
        <div className="dock-title">
          <DockUfoIcon className="size-6" />
          <div>
            <h1>Dock</h1>
            <span className="dock-title-project">{props.projectName}</span>
            <span className="dock-live" data-live={props.runningIds.length > 0 || undefined}>
              <i aria-hidden="true" />
              {props.runningIds.length} running
            </span>
            {totals && (
              <span className="dock-totals" title="All Dock processes">
                {totals.cpu.toFixed(1)}% CPU <i>·</i> {formatDockMemory(totals.memory)}
              </span>
            )}
          </div>
        </div>
        <div className="dock-topbar-actions">
          {!isEmpty && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Toggle Dock presets"
                title={servicesOpen ? "Collapse presets" : "Expand presets"}
                aria-expanded={servicesOpen}
                aria-controls={`${panelId}-services`}
                onClick={() => update({ services: !servicesOpen })}
              >
                <PanelLeftIcon className="size-4" />
                <span>Presets</span>
              </Button>
              <Menu open={arrangeOpen} onOpenChange={setArrangeOpen}>
                <MenuTrigger
                  render={<Button variant="outline" size="sm" />}
                  aria-label="Arrange Dock panes"
                >
                  <LayoutGlyph layout={view.layout} /> Arrange
                </MenuTrigger>
                <MenuPopup align="end" className="dock-arrange-menu">
                  <div className="dock-arrange-heading">Arrange panes</div>
                  <div className="dock-arrange-options">
                    {DOCK_LAYOUTS.map((layout) => (
                      <button
                        key={layout.id}
                        type="button"
                        aria-pressed={view.layout === layout.id && !view.stream}
                        disabled={layout.slots > Math.max(1, props.terminalIds.length)}
                        title={
                          layout.slots > Math.max(1, props.terminalIds.length)
                            ? `Open ${layout.slots} terminals to use ${layout.label.toLowerCase()}`
                            : layout.label
                        }
                        onClick={() => {
                          const candidates = [
                            ...(selectedId && props.terminalIds.includes(selectedId)
                              ? [selectedId]
                              : []),
                            ...props.terminalIds,
                          ].filter((id): id is string => Boolean(id));
                          const slots = [...view.slots];
                          for (let i = 0; i < layout.slots; i++)
                            if (!slots[i] || !props.terminalIds.includes(slots[i]!))
                              slots[i] =
                                candidates.find((id) => !slots.slice(0, i).includes(id)) ?? null;
                          setQuery("");
                          setErrorsOnly(false);
                          update({
                            layout: layout.id,
                            slots,
                            stream: false,
                            inspector: false,
                          });
                          setArrangeOpen(false);
                        }}
                      >
                        <LayoutGlyph layout={layout.id} />
                        <span>{layout.label}</span>
                        {view.layout === layout.id && (
                          <CheckIcon className="size-3.5 dock-layout-check" />
                        )}
                      </button>
                    ))}
                  </div>
                  <p>
                    Focus keeps terminal tabs. Split layouts show open terminals together. Open more
                    terminals to unlock larger layouts.
                  </p>
                </MenuPopup>
              </Menu>
            </>
          )}
          {isEmpty && (
            <Button variant="ghost" size="sm" onClick={props.onNewTerminal}>
              <PlusIcon className="size-3.5" />
              <span>Terminal</span>
            </Button>
          )}
          {!isEmpty && (
            <Button
              variant={view.inspector ? "secondary" : "ghost"}
              size="sm"
              aria-label="Toggle Dock inspector"
              aria-expanded={view.inspector}
              aria-controls={`${panelId}-inspector`}
              onClick={() => update({ inspector: !view.inspector })}
            >
              <PanelRightIcon className="size-4" />
              <span>Inspector</span>
            </Button>
          )}
        </div>
      </header>
      <div className="dock-body" data-empty={isEmpty || undefined}>
        {isEmpty ? (
          <DockLaunchpad
            projectName={props.projectName}
            cwd={props.cwd}
            onNewTerminal={props.onNewTerminal}
            onAdd={props.onAdd}
            onRunCommand={props.onRunCommand}
            onSaveCommand={({ label, command, run }) => {
              const id = `preset-${crypto.randomUUID()}`;
              props.onCreatePreset({
                id,
                label,
                commands: [command],
                cwd: "",
                env: {},
                autoStart: false,
              });
              if (run) setPendingRunId(id);
            }}
            loadSuggestions={props.loadSuggestions}
          />
        ) : (
          <>
            {
              <aside
                id={`${panelId}-services`}
                className="dock-services"
                data-collapsed={!servicesOpen || undefined}
                aria-label="Dock presets"
              >
                <div className="dock-section-heading">
                  <span>Presets</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="dock-add-preset"
                    aria-label="Add Dock preset"
                    title="Add a preset"
                    onClick={props.onAdd}
                  >
                    <PlusIcon className="size-3.5" />
                    <span>New</span>
                  </Button>
                </div>
                <div className="dock-service-list">
                  {props.presets.length === 0 && (
                    <DockPresetSuggestions
                      loadSuggestions={props.loadSuggestions}
                      onSave={(suggestion, run) => {
                        const id = `preset-${crypto.randomUUID()}`;
                        props.onCreatePreset({
                          id,
                          label: suggestion.name,
                          commands: [suggestion.command],
                          cwd: "",
                          env: {},
                          autoStart: false,
                        });
                        if (run) setPendingRunId(id);
                      }}
                    />
                  )}
                  {[true, false].map((running) => {
                    const group = props.presets.filter(
                      (preset) => props.runningIds.includes(preset.id) === running,
                    );
                    if (!group.length) return null;
                    return (
                      <section
                        className="dock-service-group"
                        key={String(running)}
                        aria-label={running ? "Running presets" : "Ready presets"}
                      >
                        <div className="dock-group-heading">
                          <span>{running ? "Running" : "Ready"}</span>
                          <span>{group.length}</span>
                        </div>
                        {group.map((preset) => (
                          <div
                            className="dock-service"
                            data-selected={selectedId === preset.id || undefined}
                            key={preset.id}
                            draggable={props.terminalIds.includes(preset.id)}
                            onDragStart={(event) => {
                              setDragged(preset.id);
                              event.dataTransfer.setData(DRAG, preset.id);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDragged(null)}
                          >
                            <button
                              type="button"
                              className="dock-service-select"
                              aria-pressed={selectedId === preset.id}
                              title={
                                servicesOpen
                                  ? preset.label
                                  : `${props.runningIds.includes(preset.id) ? "Stop" : "Run"} ${preset.label}`
                              }
                              aria-label={
                                servicesOpen
                                  ? `Select ${preset.label} preset`
                                  : `${props.runningIds.includes(preset.id) ? "Stop" : "Run"} ${preset.label}`
                              }
                              onClick={() => {
                                if (servicesOpen) choose(preset.id);
                                else if (props.runningIds.includes(preset.id))
                                  void closeTerminal(preset.id);
                                else runPreset(preset.id);
                              }}
                            >
                              <span className="dock-service-icon">
                                {resolvePresetIconElement(preset, "size-4")}
                              </span>
                              <span className="dock-service-label">
                                <b>{preset.label}</b>
                                <small>
                                  <i className={`dock-status ${status(preset.id)}`} />
                                  {resources.samples[preset.id] ? (
                                    <>
                                      <DockSparkline history={resources.history[preset.id] ?? []} />
                                      {resources.samples[preset.id]!.cpuPercent != null
                                        ? `${resources.samples[preset.id]!.cpuPercent!.toFixed(1)}%`
                                        : "—"}
                                      <span>
                                        ·{" "}
                                        {formatDockMemory(
                                          resources.samples[preset.id]!.memoryBytes,
                                        )}
                                      </span>
                                    </>
                                  ) : (
                                    status(preset.id)
                                  )}
                                </small>
                              </span>
                            </button>
                            <div className="dock-preset-actions">
                              <button
                                type="button"
                                aria-label={`Edit ${preset.label} preset`}
                                title={`Edit ${preset.label}`}
                                onClick={() => props.onManage(preset.id)}
                              >
                                <PencilIcon className="size-3" />
                              </button>
                              {props.onDelete && (
                                <button
                                  type="button"
                                  aria-label={`Delete ${preset.label} preset`}
                                  title={`Delete ${preset.label}`}
                                  onClick={() => props.onDelete?.(preset.id)}
                                >
                                  <Trash2Icon className="size-3" />
                                </button>
                              )}
                            </div>
                            <button
                              className="dock-service-run"
                              type="button"
                              aria-label={`${props.runningIds.includes(preset.id) ? "Stop" : "Run"} ${preset.label}`}
                              disabled={!preset.commands.some((c) => c.trim())}
                              onClick={() =>
                                props.runningIds.includes(preset.id)
                                  ? void closeTerminal(preset.id)
                                  : runPreset(preset.id)
                              }
                            >
                              {props.runningIds.includes(preset.id) ? <SquareIcon /> : <PlayIcon />}
                            </button>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  {props.terminalIds
                    .filter((id) => !props.presets.some((p) => p.id === id))
                    .map((id) => (
                      <button
                        className="dock-manual-terminal"
                        key={id}
                        type="button"
                        aria-pressed={selectedId === id}
                        onClick={() => choose(id)}
                      >
                        <TerminalIcon className="size-4" />
                        {name(id)}
                      </button>
                    ))}
                </div>
                <footer>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onManage(selected?.id)}
                    aria-label="Edit presets"
                    title="Edit presets"
                  >
                    <PencilIcon className="size-3.5" />
                    <span>Edit presets</span>
                  </Button>
                </footer>
              </aside>
            }
            <main className="dock-canvas">
              <div className="dock-document-bar">
                {view.layout === "focus" ? (
                  <div
                    className="dock-document-tabs"
                    role="tablist"
                    aria-label="Dock terminals"
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      const tabs = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                      );
                      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                              tabs.length;
                      event.preventDefault();
                      tabs[next]?.click();
                      tabs[next]?.focus();
                    }}
                  >
                    {tabIds.map((id, index) => (
                      <div
                        className="dock-document-tab"
                        data-selected={(selectedId === id && !view.stream) || undefined}
                        key={id}
                      >
                        <button
                          type="button"
                          role="tab"
                          key={id}
                          id={`${panelId}-tab-${index}`}
                          aria-selected={selectedId === id && !view.stream}
                          aria-controls={
                            view.layout === "focus"
                              ? `${panelId}-panel-${index}`
                              : `${panelId}-terminals`
                          }
                          tabIndex={selectedId === id ? 0 : -1}
                          onClick={() => choose(id)}
                        >
                          <i className={`dock-status ${status(id)}`} />
                          <span>{name(id)}</span>
                        </button>
                        {props.terminalIds.includes(id) && (
                          <button
                            type="button"
                            className="dock-tab-close"
                            aria-label={`Close ${name(id)} terminal`}
                            title={`Close ${name(id)}`}
                            onClick={() => void closeTerminal(id)}
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dock-split-heading">
                    <LayoutGlyph layout={view.layout} />
                    <span>{config.label}</span>
                    <small>{config.slots} terminals</small>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="New Dock terminal"
                  title="Open a new terminal"
                  onClick={props.onNewTerminal}
                >
                  <PlusIcon className="size-4" />
                  <span>Terminal</span>
                </Button>
                <button
                  className="dock-output-toggle"
                  type="button"
                  aria-label="Output"
                  aria-pressed={view.stream}
                  onClick={() => {
                    setQuery("");
                    setErrorsOnly(false);
                    update({ stream: !view.stream });
                  }}
                >
                  <ListIcon className="size-3.5" />
                  <span>Output</span>
                </button>
              </div>
              {view.stream && (
                <div className="dock-canvas-toolbar">
                  <label className="dock-log-search">
                    <span className="sr-only">Filter Dock logs</span>
                    <input
                      placeholder="Filter captured output…"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="dock-filter"
                    aria-pressed={errorsOnly}
                    onClick={() => {
                      setErrorsOnly(!errorsOnly);
                      update({ stream: true });
                    }}
                  >
                    Errors only
                  </button>
                  <span className="dock-toolbar-spacer" />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await navigator.clipboard.writeText(context());
                        toastManager.add({
                          type: "success",
                          title: "Dock context copied",
                          description: "Includes the command, working directory and recent output.",
                        });
                      })
                    }
                  >
                    <CopyIcon className="size-3.5" />
                    <span>Copy context</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void perform(() => props.onAddToAgent(context()))}
                  >
                    <SendIcon className="size-3.5" />
                    <span>Add to draft</span>
                  </Button>
                </div>
              )}
              {view.stream && (
                <div
                  className="dock-log-view"
                  ref={logRef}
                  role="log"
                  aria-label="Dock captured output"
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  }}
                >
                  <div className="dock-log-notice">
                    {view.stream
                      ? "Combined captured output · grouped by terminal, ordered by latest activity"
                      : "Captured output"}
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setErrorsOnly(false);
                        update({ stream: false });
                      }}
                    >
                      Return to terminals
                    </button>
                  </div>
                  {lines.some((line) => line.trim()) ? (
                    lines.map((line, i) => (
                      <div
                        key={i}
                        className={
                          /error|failed|exception|ENOTFOUND/i.test(line) ? "dock-log-error" : ""
                        }
                      >
                        {line || "\u00a0"}
                      </div>
                    ))
                  ) : (
                    <p className="dock-muted-note">
                      No matching output. Run a preset to capture its real logs.
                    </p>
                  )}
                </div>
              )}
              <div
                id={`${panelId}-terminals`}
                className={`dock-pane-grid dock-pane-${view.layout}`}
                hidden={view.stream}
                data-dragging={dragged !== null || undefined}
              >
                {Array.from(
                  { length: view.layout === "focus" ? Math.max(1, tabIds.length) : config.slots },
                  (_, index) => {
                    const candidate = view.layout === "focus" ? tabIds[index] : view.slots[index];
                    const id = candidate && available.includes(candidate) ? candidate : null;
                    const preset = props.presets.find((p) => p.id === id);
                    const hasTerminal = id !== null && props.terminalIds.includes(id);
                    return (
                      <section
                        className="dock-pane"
                        id={view.layout === "focus" ? `${panelId}-panel-${index}` : undefined}
                        key={view.layout === "focus" ? id : index}
                        hidden={view.layout === "focus" && id !== selectedId}
                        role={view.layout === "focus" && id ? "tabpanel" : undefined}
                        aria-labelledby={
                          view.layout === "focus" && id ? `${panelId}-tab-${index}` : undefined
                        }
                        aria-label={view.layout === "focus" ? undefined : `Dock pane ${index + 1}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          place(event.dataTransfer.getData(DRAG), index);
                          setDragged(null);
                        }}
                      >
                        {view.layout !== "focus" && (
                          <header
                            className="dock-pane-header"
                            draggable={Boolean(id)}
                            onDragStart={(event) => {
                              if (!id) return;
                              setDragged(id);
                              event.dataTransfer.setData(DRAG, id);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDragged(null)}
                          >
                            <span className="dock-pane-name">{id ? name(id) : "Terminal"}</span>
                            {id && (
                              <>
                                <i className={`dock-status ${status(id)}`} />
                                {preset && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Restart ${name(id)}`}
                                    onClick={() => props.onRestart(id)}
                                  >
                                    <RefreshCwIcon className="size-3" />
                                  </Button>
                                )}
                                {preset?.previewUrl && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Preview ${name(id)}`}
                                    onClick={() => props.onPreview(preset)}
                                  >
                                    <ExternalLinkIcon className="size-3" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Close ${name(id)} pane`}
                                  onClick={() => void closeTerminal(id)}
                                >
                                  <XIcon className="size-3" />
                                </Button>
                              </>
                            )}
                          </header>
                        )}
                        <div
                          className="dock-pane-content"
                          onFocusCapture={() =>
                            id && view.selected !== id && update({ selected: id })
                          }
                        >
                          {hasTerminal ? (
                            renderedTerminals.get(id!)
                          ) : (
                            <div className="dock-pane-empty">
                              <TerminalIcon className="size-6" />
                              <h3>{preset?.label ?? "Your workflow starts here"}</h3>
                              <p className={preset ? "dock-command" : undefined}>
                                {preset
                                  ? preset.commands.join(" && ")
                                  : props.presets.length
                                    ? "Choose a preset above or drag one into this pane. Press Run when you’re ready."
                                    : "Save the commands you use often—like starting your app—as a preset. Run it here and keep its output in view."}
                              </p>
                              {preset ? (
                                <Button size="sm" onClick={() => runPreset(preset.id)}>
                                  <PlayIcon className="size-3.5" />
                                  Run {preset.label}
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" onClick={props.onAdd}>
                                  <PlusIcon className="size-3.5" />
                                  Create a preset
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  },
                )}
              </div>
              <footer className="dock-session-bar">
                <span className="dock-session-path" title={selected?.cwd || props.cwd}>
                  <TerminalIcon className="size-3" />
                  {selected?.cwd || props.cwd}
                </span>
                {selectedId && (
                  <>
                    <button
                      type="button"
                      className="dock-session-resources"
                      onClick={() => update({ inspector: !view.inspector })}
                      title="Inspect process resources"
                    >
                      {selectedSample
                        ? `${selectedSample.cpuPercent != null ? `${selectedSample.cpuPercent.toFixed(1)}%` : "—"} CPU · ${formatDockMemory(selectedSample.memoryBytes)}`
                        : status(selectedId)}
                    </button>
                    {view.layout === "focus" && selected?.previewUrl && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Preview ${name(selectedId)}`}
                        onClick={() => props.onPreview(selected)}
                      >
                        <ExternalLinkIcon className="size-3" />
                      </Button>
                    )}
                    {view.layout === "focus" && selected && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Restart ${name(selectedId)}`}
                        onClick={() => props.onRestart(selectedId)}
                      >
                        <RefreshCwIcon className="size-3" />
                      </Button>
                    )}
                    {props.terminalIds.includes(selectedId) && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          selected
                            ? `Stop selected ${name(selectedId)}`
                            : `Close ${name(selectedId)}`
                        }
                        onClick={() => void closeTerminal(selectedId)}
                      >
                        {selected ? (
                          <SquareIcon className="size-3" />
                        ) : (
                          <XIcon className="size-3" />
                        )}
                      </Button>
                    )}
                  </>
                )}
              </footer>
            </main>
            {view.inspector && (
              <aside
                id={`${panelId}-inspector`}
                className="dock-inspector"
                aria-label="Dock inspector"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    update({ inspector: false });
                    document
                      .querySelector<HTMLButtonElement>('[aria-label="Toggle Dock inspector"]')
                      ?.focus();
                  }
                }}
              >
                <div className="dock-section-heading">
                  <span>Inspector</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Close Dock inspector"
                    onClick={() => update({ inspector: false })}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
                <DockResources
                  sample={selectedSample}
                  history={selectedId ? (resources.history[selectedId] ?? []) : []}
                  state={resources.state}
                  running={Boolean(selectedId && output[selectedId]?.pid)}
                />
                {selected && draft ? (
                  <form
                    key={selected.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draft.label.trim() || !draft.commands.some((c) => c.trim())) return;
                      props.onSave({
                        ...draft,
                        label: draft.label.trim(),
                        commands: draft.commands.map((c) => c.trim()).filter(Boolean),
                      });
                      toastManager.add({
                        type: "success",
                        title: "Preset saved",
                        description: "Changes apply the next time this preset starts.",
                      });
                    }}
                  >
                    <div className="dock-inspector-status">
                      <i className={`dock-status ${status(selected.id)}`} />
                      {status(selected.id)}
                      {output[selected.id]?.pid && <span>PID {output[selected.id]?.pid}</span>}
                      {output[selected.id]?.exitCode != null && (
                        <span>Exit {output[selected.id]?.exitCode}</span>
                      )}
                    </div>
                    <label>
                      Name
                      <Input
                        value={draft.label}
                        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                      />
                    </label>
                    <label>
                      Working directory
                      <Input
                        value={draft.cwd}
                        onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                      />
                    </label>
                    <label>
                      Commands, in order
                      <textarea
                        value={draft.commands.join("\n")}
                        rows={3}
                        onChange={(event) =>
                          setDraft({ ...draft, commands: event.target.value.split("\n") })
                        }
                      />
                    </label>
                    <label className="dock-switch-label">
                      Start when project opens
                      <Switch
                        checked={draft.autoStart}
                        onCheckedChange={(value) => setDraft({ ...draft, autoStart: value })}
                      />
                    </label>
                    <label>
                      Preview URL
                      <Input
                        value={draft.previewUrl ?? ""}
                        placeholder="http://localhost:5173"
                        onChange={(event) => setDraft({ ...draft, previewUrl: event.target.value })}
                      />
                    </label>
                    <label className="dock-switch-label">
                      Open preview after startup
                      <Switch
                        checked={draft.autoOpenPreview ?? false}
                        onCheckedChange={(value) => setDraft({ ...draft, autoOpenPreview: value })}
                      />
                    </label>
                    <div className="dock-inspector-footer">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!draft.label.trim() || !draft.commands.some((c) => c.trim())}
                      >
                        Save changes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => props.onManage(selected.id)}
                      >
                        More options
                      </Button>
                    </div>
                    {selected.previewUrl && (
                      <div className="dock-visual-inspector">
                        <ScanLineIcon className="size-4" />
                        <b>Inspect your interface</b>
                        <p>
                          Open the preview, then use Pick element to attach the element, styles and
                          available source context to an agent draft.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!props.canInspectPreview}
                          title={
                            !props.canInspectPreview
                              ? "Element picking is available in the desktop app"
                              : undefined
                          }
                          onClick={() => props.onInspectPreview(selected)}
                        >
                          Open preview inspector
                        </Button>
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="dock-muted-note">
                    {selectedId ? (
                      <>
                        Interactive terminal{" "}
                        <span className="dock-command">
                          {output[selectedId]?.pid ? `· PID ${output[selectedId]?.pid}` : ""}
                        </span>
                        <br />
                        {props.cwd}
                      </>
                    ) : (
                      "Select a terminal or preset to inspect it."
                    )}
                  </div>
                )}
                {props.terminalIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="dock-close-all"
                    onClick={props.onCloseAll}
                  >
                    Close all terminals
                  </Button>
                )}
              </aside>
            )}
          </>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

/** Empty presets column: the project's own scripts, one click from being presets. */
function DockPresetSuggestions({
  loadSuggestions,
  onSave,
}: {
  loadSuggestions?: (() => Promise<ScriptSuggestion[]>) | undefined;
  onSave: (suggestion: ScriptSuggestion, run: boolean) => void;
}) {
  const [suggestions, setSuggestions] = useState<ScriptSuggestion[]>([]);
  useEffect(() => {
    if (!loadSuggestions) return;
    let active = true;
    loadSuggestions()
      .then((next) => active && setSuggestions(next))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadSuggestions]);
  return (
    <div className="dock-preset-suggestions">
      <p className="dock-muted-note">
        Presets keep the commands you run every day: start, restart and watch them here.
      </p>
      {suggestions.length > 0 && (
        <>
          <div className="dock-preset-suggestions-label">From this project</div>
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion.name}>
                <button
                  type="button"
                  className="dock-preset-suggestion"
                  title={`${suggestion.command} · ${suggestion.detail}`}
                  aria-label={`Save ${suggestion.name} as a preset`}
                  onClick={() => onSave(suggestion, false)}
                >
                  <span>{suggestion.name}</span>
                  <PlusIcon aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
