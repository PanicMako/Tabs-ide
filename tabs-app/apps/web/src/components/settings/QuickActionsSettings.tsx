import { useState } from "react";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { LauncherSurface, useQuickActions } from "../quick-actions/QuickActions";
import {
  LAUNCHER_DESIGNS,
  QUICK_ACTIONS,
  orderedActions,
  type LauncherDesign,
} from "../quick-actions/actions";

export default function QuickActionsSettings() {
  const preferences = useSettings((s) => s.quickActions);
  const { updateSettings: update } = useUpdateSettings();
  const context = useQuickActions();
  const [preview, setPreview] = useState<LauncherDesign>(preferences.design);
  const actions = orderedActions(preferences.actionOrder, []);
  const patch = (value: Partial<typeof preferences>) => {
    void update({ quickActions: { ...preferences, ...value } });
  };
  const reorder = (index: number, delta: number) => {
    const ids = actions.map((a) => a.id);
    [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
    patch({ actionOrder: ids });
  };
  return (
    <div className="qa-settings">
      <section>
        <h1>Quick actions</h1>
        <p>
          Your next move, where your pointer already is. Use the compass button in the bottom left
          or the Quick Actions shortcut in Keybindings (default: ⌘ Option K / Ctrl Alt K).
        </p>
      </section>
      <section>
        <div className="qa-designs">
          {LAUNCHER_DESIGNS.map((design) => (
            <button
              key={design.id}
              type="button"
              aria-pressed={preview === design.id}
              onClick={() => setPreview(design.id)}
            >
              <strong>
                {design.name}
                {preferences.design === design.id ? " · Selected" : ""}
              </strong>
              <span>{design.description}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="qa-setting-row">
          <span>Interactive preview · Actions run in your current workspace.</span>
          <button
            type="button"
            disabled={preview === preferences.design}
            onClick={() => patch({ design: preview })}
          >
            Use this design
          </button>
        </div>
        <div className="qa-preview">
          {context ? (
            <LauncherSurface
              key={preview}
              design={preview}
              actions={orderedActions(preferences.actionOrder, preferences.hiddenActions)}
              execute={context.execute}
              disabled={context.disabled}
              preview
            />
          ) : (
            <p>Open settings from the workspace to try actions.</p>
          )}
        </div>
      </section>
      <section>
        <h2>Make it yours</h2>
        <label className="qa-setting-row">
          <span>Alt + right-click in workspace chrome to open at the pointer</span>
          <input
            type="checkbox"
            checked={preferences.pointerGesture}
            onChange={(e) => patch({ pointerGesture: e.target.checked })}
          />
        </label>
        <p>
          Change “Quick Actions: Toggle” in Settings → Keybindings. Escape returns focus. Arrow keys
          navigate; Tab reaches every control. The keypad also accepts 1–9 when its buttons have
          focus.
        </p>
        {actions.map((action, index) => (
          <div className="qa-setting-row" key={action.id}>
            <label>
              <input
                aria-label={`Show ${action.label}`}
                type="checkbox"
                checked={!preferences.hiddenActions.includes(action.id)}
                disabled={action.id === "customize"}
                onChange={(e) =>
                  patch({
                    hiddenActions: e.target.checked
                      ? preferences.hiddenActions.filter((id) => id !== action.id)
                      : [...preferences.hiddenActions, action.id],
                  })
                }
              />
            </label>
            <span>{action.label}</span>
            <button
              aria-label={`Move ${action.label} earlier`}
              disabled={index === 0}
              onClick={() => reorder(index, -1)}
            >
              ↑
            </button>
            <button
              aria-label={`Move ${action.label} later`}
              disabled={index === actions.length - 1}
              onClick={() => reorder(index, 1)}
            >
              ↓
            </button>
          </div>
        ))}
        <div className="maintenance-controls">
          <button
            type="button"
            onClick={() =>
              patch({
                actionOrder: QUICK_ACTIONS.map((a) => a.id),
                hiddenActions: [],
                pointerGesture: false,
                design: "list",
              })
            }
          >
            Restore defaults
          </button>
        </div>
      </section>
    </div>
  );
}
