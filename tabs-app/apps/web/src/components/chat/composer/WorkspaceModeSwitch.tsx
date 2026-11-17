import gsap from "gsap";
import { FolderIcon, GitForkIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../../lib/utils";
import { usePanelAnimationSettings } from "../../../panelAnimations";
import type { EnvMode } from "../../BranchToolbar.logic";
import "./composer-layout.css";

const OPTIONS = [
  {
    mode: "local",
    label: "This checkout",
    icon: FolderIcon,
    hint: "Edits your files right here",
  },
  {
    mode: "worktree",
    label: "New worktree",
    icon: GitForkIcon,
    hint: "A separate copy on its own branch — safe to experiment",
  },
] as const satisfies ReadonlyArray<{
  mode: EnvMode;
  label: string;
  icon: typeof FolderIcon;
  hint: string;
}>;

/**
 * Where the agent works. The chosen place shows its name; the other is an icon
 * you can tap. Choosing morphs the words across in one motion, and a short line
 * fades in on hover to say what each place means.
 */
export function WorkspaceModeSwitch(props: {
  readonly mode: EnvMode;
  readonly locked: boolean;
  /** Set once the thread runs in a worktree. */
  readonly inWorktree: boolean;
  readonly onChange: (mode: EnvMode) => void;
}) {
  const { reducedMotion } = usePanelAnimationSettings();
  const railRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const placedRef = useRef(false);
  const [hovered, setHovered] = useState<EnvMode | null>(null);

  useLayoutEffect(() => {
    if (props.locked) return;
    const rail = railRef.current;
    const indicator = indicatorRef.current;
    if (!rail || !indicator) return;
    const labels = OPTIONS.map((option) =>
      rail.querySelector<HTMLElement>(`[data-mode="${option.mode}"] [data-label]`),
    );
    const active = rail.querySelector<HTMLElement>(`[data-mode="${props.mode}"]`);
    if (!active) return;
    const follow = () => gsap.set(indicator, { x: active.offsetLeft, width: active.offsetWidth });

    const widths: ReadonlyArray<string | number> = OPTIONS.map((option) =>
      option.mode === props.mode ? "auto" : 0,
    );
    if (!placedRef.current || reducedMotion) {
      placedRef.current = true;
      labels.forEach((label, index) =>
        gsap.set(label, { width: widths[index] ?? 0, opacity: (widths[index] ?? 0) === 0 ? 0 : 1 }),
      );
      follow();
      return;
    }
    const timeline = gsap.timeline({
      defaults: { duration: 0.46, ease: "expo.out" },
      onUpdate: follow,
    });
    labels.forEach((label, index) =>
      timeline.to(
        label,
        { width: widths[index] ?? 0, opacity: (widths[index] ?? 0) === 0 ? 0 : 1 },
        0,
      ),
    );
    return () => {
      timeline.progress(1).kill();
    };
  }, [props.mode, props.locked, reducedMotion]);

  if (props.locked) {
    const Icon = props.inWorktree ? GitForkIcon : FolderIcon;
    return (
      <span className="workspace-mode-locked" title="Chosen when this thread started">
        <Icon className="size-3.5" aria-hidden="true" />
        {props.inWorktree ? "In its own worktree" : "In this checkout"}
      </span>
    );
  }

  const hint = hovered ? OPTIONS.find((option) => option.mode === hovered)?.hint : undefined;
  return (
    <div className="workspace-mode" onPointerLeave={() => setHovered(null)}>
      <span
        className={cn("workspace-mode-hint", hint && "workspace-mode-hint-visible")}
        aria-live="polite"
      >
        {hint}
      </span>
      <div
        ref={railRef}
        role="radiogroup"
        aria-label="Where the agent works"
        className="workspace-mode-rail"
      >
        <span ref={indicatorRef} aria-hidden="true" className="workspace-mode-indicator" />
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.mode === props.mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${option.label}: ${option.hint}`}
              data-mode={option.mode}
              data-selected={selected ? "true" : undefined}
              onPointerEnter={() => setHovered(option.mode)}
              onFocus={() => setHovered(option.mode)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                setHovered(null);
                props.onChange(option.mode);
              }}
              className="workspace-mode-option"
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span data-label className="workspace-mode-label">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
