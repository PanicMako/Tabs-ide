import type { TeammateFinish, TeammateMood } from "@tabs/contracts";
import { cn } from "~/lib/utils";
import { TabsMascot } from "../TabsMascot";
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
}: {
  mood?: TeammateMood;
  finish?: TeammateFinish;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn("notch-avatar", className)}
      data-mood={mood}
      data-finish={finish}
      title={title}
    >
      <TabsMascot mode="still" eyeColor="currentColor" look={moodLook(mood)} />
    </span>
  );
}
