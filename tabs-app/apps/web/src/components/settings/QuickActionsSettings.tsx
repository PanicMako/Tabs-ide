import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  RotateCcwIcon,
  ChevronDownIcon,
  GripVerticalIcon,
} from "lucide-react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { LauncherSurface, useQuickActions } from "../quick-actions/QuickActions";
import {
  LAUNCHER_DESIGNS,
  DEFAULT_SUB_ACTIONS,
  normalizeLauncherDesign,
  QUICK_ACTIONS,
  orderedActions,
  type LauncherDesign,
} from "../quick-actions/actions";

import { QuickSubActionsSettings } from "./QuickSubActionsSettings";

export default function QuickActionsSettings() {
  const preferences = useSettings((s) => s.quickActions);
  const { updateSettings: update } = useUpdateSettings();
  const context = useQuickActions();
  const [preview, setPreview] = useState<LauncherDesign>(
    normalizeLauncherDesign(preferences.design),
  );
  const [expandedAction, setExpandedAction] = useState<string | null>("scratch-browser");
  const actions = orderedActions(preferences.actionOrder, []);
  const patch = (value: Partial<typeof preferences>) => {
    void update({ quickActions: { ...preferences, ...value } });
  };
  const reorder = (index: number, delta: number) => {
    const ids = actions.map((a) => a.id);
    [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
    patch({ actionOrder: ids });
  };
  const selected = LAUNCHER_DESIGNS.find((design) => design.id === preview)!;
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Quick Actions"
        description="Choose how your launcher looks and keep your most useful actions close."
      />
      <SettingsSection
        title="Launcher design"
        description="Three radial launchers. Choose a design to try it before applying."
      >
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[140px_minmax(0,1fr)]">
          <div
            className="grid content-start gap-1.5 sm:grid-cols-2 lg:grid-cols-1"
            aria-label="Launcher designs"
          >
            {LAUNCHER_DESIGNS.map((design) => (
              <button
                type="button"
                key={design.id}
                aria-pressed={preview === design.id}
                onClick={() => setPreview(design.id)}
                className={`rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${preview === design.id ? "border-ring/50 bg-accent" : "border-transparent hover:bg-muted/60"}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {design.name}
                  {normalizeLauncherDesign(preferences.design) === design.id && (
                    <CheckIcon
                      className="size-3.5 text-muted-foreground"
                      aria-label="Current design"
                    />
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground lg:hidden">
                  {design.description}
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{selected.name} preview</span>
              <Button
                size="sm"
                variant="outline"
                disabled={preview === normalizeLauncherDesign(preferences.design)}
                onClick={() => patch({ design: preview })}
              >
                {preview === normalizeLauncherDesign(preferences.design)
                  ? "Current design"
                  : "Use this design"}
              </Button>
            </div>
            <div className="qa-preview !p-3 sm:!p-4">
              {context ? (
                <LauncherSurface
                  key={preview}
                  design={preview}
                  actions={orderedActions(preferences.actionOrder, preferences.hiddenActions)}
                  subActions={preferences.subActions}
                  execute={context.execute}
                  disabled={context.disabled}
                  preview
                />
              ) : (
                <p className="py-6 text-sm text-muted-foreground">
                  Open settings from your workspace to try actions.
                </p>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selected.description} Preview actions run in your current workspace.
            </p>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Open the launcher"
        description="Use Tools → Quick Actions or your Quick Actions shortcut."
      >
        <SettingsRow
          title="Open at the pointer"
          description="Option / Alt + right-click in workspace chrome."
          control={
            <Switch
              aria-label="Open at the pointer"
              checked={preferences.pointerGesture}
              onCheckedChange={(checked) => patch({ pointerGesture: checked })}
            />
          }
        />
        <SettingsRow
          title="Keyboard shortcut"
          description="Change Quick Actions: Toggle in Keybindings. The default is Command-Option-K on macOS and Ctrl-Alt-K on Windows and Linux."
          status="Escape returns focus. Arrow keys navigate; Tab reaches every control. Choose More for workspace and settings actions."
        />
      </SettingsSection>
      <SettingsSection
        title="Actions & shortcuts"
        description="Turn actions on or off, drag to arrange the ring, and expand an action to manage its shortcuts."
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreview("compass");
              patch({
                actionOrder: QUICK_ACTIONS.map((a) => a.id),
                hiddenActions: [],
                pointerGesture: false,
                design: "compass",
                subActions: [...DEFAULT_SUB_ACTIONS],
              });
            }}
          >
            <RotateCcwIcon className="size-3.5" />
            Restore defaults
          </Button>
        }
      >
        {actions.map((action, index) => (
          <div key={action.id} className="border-t border-border first:border-t-0">
            <div
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("application/x-tabs-action", action.id)
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData("application/x-tabs-action");
                const ids = actions.map((entry) => entry.id);
                const start = ids.findIndex((id) => id === from);
                if (start < 0 || start === index) return;
                const [moved] = ids.splice(start, 1);
                ids.splice(index, 0, moved!);
                patch({ actionOrder: ids });
              }}
              data-slot="settings-row"
              className="flex items-center gap-2 px-4 py-3 sm:px-5"
            >
              <GripVerticalIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground/50"
              />
              <Checkbox
                aria-label={`Show ${action.label}`}
                checked={!preferences.hiddenActions.includes(action.id)}
                disabled={action.id === "customize"}
                onCheckedChange={(checked) =>
                  patch({
                    hiddenActions: checked
                      ? preferences.hiddenActions.filter((id) => id !== action.id)
                      : [...preferences.hiddenActions, action.id],
                  })
                }
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                aria-expanded={expandedAction === action.id}
                aria-label={`Configure ${action.label}`}
                onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
              >
                <span className="block text-sm font-medium">{action.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {
                    (preferences.subActions ?? DEFAULT_SUB_ACTIONS).filter(
                      (entry) => entry.parentId === action.id,
                    ).length
                  }{" "}
                  shortcuts{preferences.hiddenActions.includes(action.id) ? " · Hidden" : ""}
                </span>
              </button>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Move ${action.label} earlier`}
                  disabled={index === 0}
                  onClick={() => reorder(index, -1)}
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Move ${action.label} later`}
                  disabled={index === actions.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  <ArrowDownIcon className="size-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Configure ${action.label} shortcuts`}
                  aria-expanded={expandedAction === action.id}
                  onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                >
                  <ChevronDownIcon
                    className={`size-3.5 transition-transform ${expandedAction === action.id ? "rotate-180" : ""}`}
                  />
                </Button>
              </div>
            </div>
            {expandedAction === action.id && (
              <div className="border-t border-border bg-muted/20">
                <QuickSubActionsSettings
                  parentId={action.id}
                  embedded
                  value={preferences.subActions ?? DEFAULT_SUB_ACTIONS}
                  onChange={(subActions) => patch({ subActions })}
                />
              </div>
            )}
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}
