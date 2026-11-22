import type { RuntimeMode } from "@tabs/contracts";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { resolveCompatibleRuntimeMode, runtimeModeConfig } from "./runtimeModeConfig";
import "./compact-model-picker.css";

/**
 * Build or plan, and how much the agent may do on its own, in one quiet control for narrow
 * composers (a side chat, a popped-out chat). The button shows only the current access icon and
 * whether it builds or plans; everything else is in the panel it opens.
 */
export function ModeAccessPicker(props: {
  readonly interactionMode: "default" | "plan";
  readonly onToggleInteractionMode: () => void;
  readonly runtimeMode: RuntimeMode;
  /** Modes the selected provider offers; every mode when omitted. */
  readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode> | undefined;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const { modes, mode } = resolveCompatibleRuntimeMode(
    props.runtimeMode,
    props.supportedRuntimeModes,
  );
  const planning = props.interactionMode === "plan";
  const AccessIcon = runtimeModeConfig[mode].icon;
  const setPlanning = (next: boolean) => {
    if (next !== planning) props.onToggleInteractionMode();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Mode and access: ${planning ? "plans" : "builds"}, ${runtimeModeConfig[mode].label}`}
            className="shrink-0 gap-1.5 px-2 text-muted-foreground/80 hover:text-foreground [&_svg]:mx-0"
          />
        }
      >
        <AccessIcon aria-hidden="true" className="size-4" />
        <span className="text-[13px] font-medium text-foreground">
          {planning ? "plans" : "builds"}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="top"
        sideOffset={8}
        className="mac-popup"
        viewportClassName="!p-0"
      >
        <div className="mac">
          <div className="cmp-think-row">
            <span className="cmp-think-label">Mode</span>
            <div role="radiogroup" aria-label="Mode" className="cmp-seg">
              {[
                { label: "Build", hint: "Builds directly", value: false },
                { label: "Plan", hint: "Plans first, then builds", value: true },
              ].map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  role="radio"
                  aria-checked={planning === choice.value}
                  title={choice.hint}
                  className="cmp-seg-item no-drag"
                  onClick={() => setPlanning(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <div className="cmp-think-row">
            <span className="cmp-think-label">Access</span>
            <div role="radiogroup" aria-label="Access" className="mac-list">
              {modes.map((option) => {
                const config = runtimeModeConfig[option];
                const Icon = config.icon;
                const selected = option === mode;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn("mac-row no-drag")}
                    onClick={() => {
                      props.onRuntimeModeChange(option);
                      setOpen(false);
                    }}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
                    <span className="mac-row-text">
                      <span className="mac-row-title">{config.label}</span>
                      <span className="mac-row-hint">{config.description}</span>
                    </span>
                    {selected ? (
                      <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
