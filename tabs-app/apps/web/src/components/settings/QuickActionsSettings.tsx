import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { useKeybindings } from "~/state/settings";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsSection, SettingsSectionHeader } from "./SettingsLayout";
import { LauncherSurface, useQuickActions } from "../quick-actions/QuickActions";
import {
  LAUNCHER_DESIGNS,
  DEFAULT_SUB_ACTIONS,
  normalizeLauncherDesign,
  QUICK_ACTIONS,
  orderedActions,
  type LauncherDesign,
} from "../quick-actions/actions";

import { QuickActionsArranger } from "./QuickActionsArranger";
import { useInstalledExtensions } from "../../state/extensions";
import { extensionLauncherActions } from "../quick-actions/extensionQuickActions";
import "./quick-actions-studio.css";

/** A small drawing of each launcher, so the list can be read at a glance. */
function DesignGlyph({ design }: { design: LauncherDesign }) {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg className="qa-studio-glyph" viewBox="-24 -24 48 48" aria-hidden="true">
      {design === "compass" ? (
        <>
          <circle r="16" fill="none" stroke="currentColor" strokeOpacity="0.25" />
          {angles.map((angle, index) => (
            <circle
              key={angle}
              cx={16 * Math.sin((angle * Math.PI) / 180)}
              cy={-16 * Math.cos((angle * Math.PI) / 180)}
              r={index === 0 ? 4.5 : 3}
              fill={index === 0 ? "var(--primary)" : "currentColor"}
            />
          ))}
        </>
      ) : (
        angles.map((angle, index) => (
          <path
            key={angle}
            d="M-7 -19.5 A21 21 0 0 1 7 -19.5 L3 -8.5 A9 9 0 0 0 -3 -8.5 Z"
            transform={`rotate(${angle})`}
            fill={index === 0 ? "var(--primary)" : "currentColor"}
            fillOpacity={index === 0 ? 1 : 0.4}
          />
        ))
      )}
    </svg>
  );
}

export default function QuickActionsSettings() {
  const preferences = useSettings((s) => s.quickActions);
  const installedExtensions = useInstalledExtensions();
  const { updateSettings: update } = useUpdateSettings();
  const context = useQuickActions();
  const keybindings = useKeybindings();
  const shortcut = shortcutLabelForCommand(keybindings, "quickActions.toggle");
  const current = normalizeLauncherDesign(preferences.design);
  const patch = (value: Partial<typeof preferences>) => {
    void update({ quickActions: { ...preferences, ...value } });
  };
  const selected = LAUNCHER_DESIGNS.find((design) => design.id === current)!;
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title="Quick Actions"
        description="Choose how your launcher looks and keep your most useful actions close."
      />
      <SettingsSection title="Launcher" className="qa-studio-section">
        <div className="qa-studio">
          <div className="qa-studio-layout">
            <div className="qa-studio-library">
              <div className="qa-studio-list" role="group" aria-label="Launcher designs">
                {LAUNCHER_DESIGNS.map((design) => (
                  <button
                    type="button"
                    key={design.id}
                    aria-label={`Design: ${design.name}`}
                    aria-pressed={current === design.id}
                    onClick={() => patch({ design: design.id })}
                    className="qa-studio-choice"
                  >
                    <DesignGlyph design={design.id} />
                    <span className="qa-studio-choice-copy">
                      <span className="qa-studio-choice-name">{design.name}</span>
                      <small>{design.tagline}</small>
                    </span>
                    {current === design.id && (
                      <CheckIcon className="qa-studio-choice-mark" aria-label="Current design" />
                    )}
                  </button>
                ))}
              </div>
              <div className="qa-studio-options">
                <div className="qa-studio-option">
                  <span>
                    <strong>Quick Actions</strong>
                    <small>Tools menu, shortcut or gesture</small>
                  </span>
                  <Switch
                    aria-label="Enable Quick Actions"
                    checked={preferences.enabled}
                    onCheckedChange={(enabled) => patch({ enabled })}
                  />
                </div>
                <div className="qa-studio-option">
                  <span>
                    <strong>Open at the pointer</strong>
                    <small>Option / Alt + right-click</small>
                  </span>
                  <Switch
                    aria-label="Open at the pointer"
                    checked={preferences.pointerGesture}
                    disabled={!preferences.enabled}
                    onCheckedChange={(checked) => patch({ pointerGesture: checked })}
                  />
                </div>
                <div className="qa-studio-option">
                  <span>
                    <strong>Keyboard shortcut</strong>
                    <small>Change it in Keybindings</small>
                  </span>
                  <kbd className="qa-studio-kbd">{shortcut ?? "Not set"}</kbd>
                </div>
              </div>
            </div>
            <div className="qa-studio-feature">
              <div className="qa-studio-stage">
                <div className="qa-preview">
                  <LauncherSurface
                    key={current}
                    design={current}
                    actions={orderedActions(
                      preferences.actionOrder,
                      preferences.hiddenActions,
                      preferences.customActions,
                      extensionLauncherActions(installedExtensions),
                    )}
                    subActions={preferences.subActions}
                    execute={context?.execute ?? (async () => {})}
                    disabled={(id) =>
                      !context
                        ? "Open settings from your workspace to try actions."
                        : preferences.enabled
                          ? context.disabled(id)
                          : "Enable Quick Actions to run this action."
                    }
                    preview
                  />
                </div>
              </div>
              <div className="qa-studio-copy">
                <h4>{selected.name}</h4>
                <p>{selected.description} Actions you try here run in your current workspace.</p>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Actions & shortcuts"
        description="Make your own actions and drag any of them between the ring, More and Hidden."
        headerAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
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
        <QuickActionsArranger
          order={preferences.actionOrder}
          hidden={preferences.hiddenActions}
          subActions={preferences.subActions ?? DEFAULT_SUB_ACTIONS}
          customActions={preferences.customActions ?? []}
          onPatch={patch}
        />
      </SettingsSection>
    </div>
  );
}
