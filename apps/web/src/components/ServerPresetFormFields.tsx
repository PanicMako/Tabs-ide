import React, { useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { ScrollArea } from "./ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import {
  ChevronUpIcon,
  ChevronDownIcon,
  XIcon,
  PlusIcon,
  GlobeIcon,
  ServerIcon,
  DatabaseIcon,
  TerminalSquareIcon,
  RocketIcon,
  CodeIcon,
  CpuIcon,
  ZapIcon,
  LayersIcon,
  PlayIcon,
  WrenchIcon,
  WorkflowIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { ServerProcessDraft } from "./ProjectWorkspaceSettingsSection";

export const PRESET_ICON_OPTIONS = [
  { id: "globe", label: "Web / Frontend", icon: GlobeIcon },
  { id: "server", label: "Server / Backend", icon: ServerIcon },
  { id: "database", label: "Database", icon: DatabaseIcon },
  { id: "terminal", label: "Terminal", icon: TerminalSquareIcon },
  { id: "rocket", label: "Rocket", icon: RocketIcon },
  { id: "code", label: "Code", icon: CodeIcon },
  { id: "cpu", label: "Worker / CPU", icon: CpuIcon },
  { id: "zap", label: "Fast / Zap", icon: ZapIcon },
  { id: "layers", label: "Layers", icon: LayersIcon },
  { id: "play", label: "Play", icon: PlayIcon },
  { id: "wrench", label: "Build / Wrench", icon: WrenchIcon },
  { id: "workflow", label: "Workflow", icon: WorkflowIcon },
] as const;

export function resolveDefaultPresetIconId(label: string): string {
  const lower = (label || "").toLowerCase();
  if (
    lower.includes("front") ||
    lower.includes("web") ||
    lower.includes("ui") ||
    lower.includes("client") ||
    lower.includes("app") ||
    lower.includes("vite") ||
    lower.includes("next")
  ) {
    return "globe";
  }
  if (
    lower.includes("back") ||
    lower.includes("api") ||
    lower.includes("server") ||
    lower.includes("srv") ||
    lower.includes("node")
  ) {
    return "server";
  }
  if (
    lower.includes("db") ||
    lower.includes("data") ||
    lower.includes("sql") ||
    lower.includes("redis") ||
    lower.includes("postgres") ||
    lower.includes("mongo")
  ) {
    return "database";
  }
  if (
    lower.includes("worker") ||
    lower.includes("queue") ||
    lower.includes("job") ||
    lower.includes("cron")
  ) {
    return "cpu";
  }
  if (
    lower.includes("build") ||
    lower.includes("bundle") ||
    lower.includes("compile") ||
    lower.includes("watch")
  ) {
    return "wrench";
  }
  return "terminal";
}

export function resolvePresetIconElement(
  preset: { label?: string | undefined; icon?: string | null | undefined },
  className = "size-3.5",
): React.ReactElement {
  const iconId = preset.icon || resolveDefaultPresetIconId(preset.label || "");
  const found = PRESET_ICON_OPTIONS.find((opt) => opt.id === iconId);
  const IconComponent = found ? found.icon : TerminalSquareIcon;
  return <IconComponent className={className} />;
}

export function ServerPresetFormFields(props: {
  preset: ServerProcessDraft;
  presetDrafts: ServerProcessDraft[];
  projectCwd: string;
  isEditing?: boolean;
  presetRowRef?: (node: HTMLDivElement | null) => void;
  updatePresetRow: (
    id: string,
    updater: (current: ServerProcessDraft) => ServerProcessDraft,
  ) => void;
  addCommandStep: (id: string) => void;
  updateCommandStep: (id: string, index: number, command: string) => void;
  moveCommandStep: (id: string, index: number, direction: -1 | 1) => void;
  removeCommandStep: (id: string, index: number) => void;
  movePresetRow?: (id: string, direction: -1 | 1) => void;
  removePresetRow?: (id: string) => void;
  index?: number;
  variant?: "card" | "plain";
}) {
  const {
    preset,
    presetDrafts,
    projectCwd,
    isEditing,
    presetRowRef,
    updatePresetRow,
    addCommandStep,
    updateCommandStep,
    moveCommandStep,
    removeCommandStep,
    movePresetRow,
    removePresetRow,
    index,
    variant = "card",
  } = props;

  const [isBrowserSetupOpen, setIsBrowserSetupOpen] = useState(
    () => preset.autoOpenPreview || !!preset.previewUrl || preset.previewOpenTarget === "external",
  );

  const displayIndex = index ?? 0;

  return (
    <div
      key={preset.id}
      ref={(node) => {
        if (presetRowRef) presetRowRef(node);
      }}
      className={
        variant === "card"
          ? cn(
              "space-y-3 rounded-2xl border border-border/70 p-4",
              isEditing && "border-primary/50 ring-1 ring-primary/30",
            )
          : "space-y-4"
      }
    >
      {variant === "card" && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">Preset {displayIndex + 1}</div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              disabled={index === undefined || index === 0}
              onClick={() => movePresetRow?.(preset.id, -1)}
              aria-label={`Move preset ${displayIndex + 1} up`}
            >
              <ChevronUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              disabled={index === undefined || index === presetDrafts.length - 1}
              onClick={() => movePresetRow?.(preset.id, 1)}
              aria-label={`Move preset ${displayIndex + 1} down`}
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              onClick={() => removePresetRow?.(preset.id)}
              aria-label={`Delete preset ${displayIndex + 1}`}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium text-foreground">Label</div>
          <Input
            value={preset.label}
            onChange={(event) =>
              updatePresetRow(preset.id, (current) => ({
                ...current,
                label: event.target.value,
              }))
            }
            placeholder="Frontend"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Icon</span>
            {preset.icon ? (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                onClick={() =>
                  updatePresetRow(preset.id, (current) => {
                    const { icon: _, ...rest } = current;
                    return rest;
                  })
                }
              >
                Reset to auto-detect
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">Auto-detected from label</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 p-1.5">
            {PRESET_ICON_OPTIONS.map((opt) => {
              const IconComp = opt.icon;
              const isSelected =
                preset.icon === opt.id ||
                (!preset.icon && resolveDefaultPresetIconId(preset.label) === opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.label}
                  onClick={() =>
                    updatePresetRow(preset.id, (current) => ({
                      ...current,
                      icon: opt.id,
                    }))
                  }
                  className={cn(
                    "flex size-7 items-center justify-center rounded-lg border text-xs transition-all cursor-pointer",
                    isSelected
                      ? "border-primary/50 bg-primary/15 text-foreground shadow-xs"
                      : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <IconComp className="size-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">Command Steps</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addCommandStep(preset.id)}
          >
            <PlusIcon className="size-3.5" />
            Add Step
          </Button>
        </div>
        <div className="space-y-2">
          {preset.commands.map((command: string, commandIndex: number) => {
            const stepKey = `${preset.id}-step-${commandIndex}`;
            return (
              <div key={stepKey} className="flex gap-2">
                <div className="flex h-10 min-w-10 items-center justify-center rounded-xl border border-border/70 bg-muted/20 text-xs font-medium text-muted-foreground">
                  {commandIndex + 1}
                </div>
                <Input
                  value={command}
                  onChange={(event) =>
                    updateCommandStep(preset.id, commandIndex, event.target.value)
                  }
                  placeholder={
                    commandIndex === 0
                      ? "npm install"
                      : commandIndex === 1
                        ? "npm run dev"
                        : "echo ready"
                  }
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  disabled={commandIndex === 0}
                  onClick={() => moveCommandStep(preset.id, commandIndex, -1)}
                  aria-label={`Move step ${commandIndex + 1} up`}
                >
                  <ChevronUpIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  disabled={commandIndex === preset.commands.length - 1}
                  onClick={() => moveCommandStep(preset.id, commandIndex, 1)}
                  aria-label={`Move step ${commandIndex + 1} down`}
                >
                  <ChevronDownIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  disabled={preset.commands.length === 1}
                  onClick={() => removeCommandStep(preset.id, commandIndex)}
                  aria-label={`Delete step ${commandIndex + 1}`}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">Working Directory</div>
        <Input
          value={preset.cwd}
          onChange={(event) =>
            updatePresetRow(preset.id, (current) => ({
              ...current,
              cwd: event.target.value,
            }))
          }
          placeholder={projectCwd}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">Auto-start</div>
          <div className="text-xs text-muted-foreground">
            Launch this preset automatically when the Launchpad tab opens.
          </div>
        </div>
        <Switch
          checked={preset.autoStart}
          onCheckedChange={(checked) =>
            updatePresetRow(preset.id, (current) => ({
              ...current,
              autoStart: Boolean(checked),
            }))
          }
        />
      </div>

      <div className="space-y-4 pt-4 border-t border-border/40">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">Browser Tool Integration</div>
          <Switch
            checked={isBrowserSetupOpen}
            onCheckedChange={(checked) => {
              setIsBrowserSetupOpen(Boolean(checked));
              if (!checked) {
                updatePresetRow(preset.id, (current) => ({
                  ...current,
                  previewUrl: undefined,
                  autoOpenPreview: undefined,
                  previewOpenTarget: undefined,
                  previewFocus: undefined,
                }));
              }
            }}
          />
        </div>
        {isBrowserSetupOpen && (
          <div className="space-y-4 animate-in fade-in-0 slide-in-from-top-1">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">URL Target</div>
              <Input
                value={preset.previewUrl || ""}
                onChange={(event) =>
                  updatePresetRow(preset.id, (current) => ({
                    ...current,
                    previewUrl: event.target.value,
                  }))
                }
                placeholder="http://localhost:3000"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-foreground">Target Browser</div>
              <div className="tabs-segmented flex" role="group" aria-label="Target browser">
                <button
                  type="button"
                  onClick={() =>
                    updatePresetRow(preset.id, (current) => ({
                      ...current,
                      previewOpenTarget: "in-app",
                    }))
                  }
                  aria-pressed={preset.previewOpenTarget !== "external"}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer",
                    preset.previewOpenTarget !== "external"
                      ? "font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Internal Browser
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updatePresetRow(preset.id, (current) => ({
                      ...current,
                      previewOpenTarget: "external",
                    }))
                  }
                  aria-pressed={preset.previewOpenTarget === "external"}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer",
                    preset.previewOpenTarget === "external"
                      ? "font-semibold"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Default Browser
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">Auto-switch to browser</div>
                <div className="text-xs text-muted-foreground">
                  Open the browser tool tab automatically when the preset starts.
                </div>
              </div>
              <Switch
                checked={preset.autoOpenPreview ?? false}
                onCheckedChange={(checked) =>
                  updatePresetRow(preset.id, (current) => ({
                    ...current,
                    autoOpenPreview: Boolean(checked),
                  }))
                }
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-border/40">
        <div>
          <div className="text-sm font-medium text-foreground mb-1">Dependencies</div>
          <div className="text-xs text-muted-foreground">
            Select presets that must start before this one. They will run automatically with a
            slight delay.
          </div>
        </div>
        {presetDrafts.filter((p: any) => p.id !== preset.id).length > 0 ? (
          <div className="space-y-2">
            {presetDrafts
              .filter((p: any) => p.id !== preset.id)
              .map((dep: any) => {
                const isChecked = preset.dependsOn?.includes(dep.id) ?? false;
                return (
                  <div
                    key={dep.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {dep.label || "Untitled Preset"}
                    </span>
                    <Switch
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        updatePresetRow(preset.id, (current) => {
                          const currentDependsOn = current.dependsOn || [];
                          const nextDependsOn = checked
                            ? [...currentDependsOn, dep.id]
                            : currentDependsOn.filter((id: string) => id !== dep.id);
                          return { ...current, dependsOn: nextDependsOn };
                        });
                      }}
                    />
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground/60 italic border border-border/40 rounded-xl px-3 py-3 text-center bg-muted/20">
            No other presets available to depend on.
          </div>
        )}
      </div>
    </div>
  );
}
