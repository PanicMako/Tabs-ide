import type { TeammateFinish, TeammateMood } from "@tabs/contracts";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { TabsMascot } from "../TabsMascot";
import { finishStyle, materialFor } from "./notchFinish";
import { moodLook } from "./notchMood";
import "./notch-avatar.css";

/**
 * A teammate drawn as the Tabs mascot. The mood sets the animation (see notch-avatar.css) and
 * the finish picks the brand colours. Size it with className (the mascot fills its box).
 */
export function NotchAvatar({
  mood = "idle",
  finish = "signature",
  className,
  title,
  look,
  overlay,
}: {
  mood?: TeammateMood;
  finish?: TeammateFinish;
  className?: string;
  title?: string;
  /** Where the eyes point, overriding the mood's own look. */
  look?: { x: number; y: number } | undefined;
  overlay?: ReactNode;
}) {
  return (
    <span
      className={cn("notch-avatar", className)}
      data-mood={mood}
      data-finish={finish}
      title={title}
      style={finishStyle(finish)}
    >
      <TabsMascot
        mode="still"
        eyeColor="currentColor"
        look={look ?? moodLook(mood)}
        material={materialFor(finish)}
        overlay={overlay}
      />
    </span>
  );
}
