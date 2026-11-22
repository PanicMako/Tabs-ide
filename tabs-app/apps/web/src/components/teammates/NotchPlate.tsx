import type { TeammateFinish, TeammateMood } from "@tabs/contracts";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { NotchAvatar } from "./NotchAvatar";
import { finishStyle } from "./notchFinish";

/** The mascot on a plate in its finish: a small logo swatch for pickers and template cards. */
export function NotchPlate({
  finish,
  mood = "idle",
  className,
  avatarClassName = "size-3/4",
  look,
  overlay,
  children,
}: {
  finish: TeammateFinish;
  mood?: TeammateMood;
  className?: string;
  avatarClassName?: string;
  look?: { x: number; y: number } | undefined;
  overlay?: ReactNode;
  /** Drawn on the plate behind the mascot. */
  children?: ReactNode;
}) {
  return (
    <span
      className={cn("notch-plate", className)}
      data-finish={finish}
      style={finishStyle(finish)}
      aria-hidden="true"
    >
      {children}
      <NotchAvatar
        finish={finish}
        mood={mood}
        className={avatarClassName}
        look={look}
        overlay={overlay}
      />
    </span>
  );
}
