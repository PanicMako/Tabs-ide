import type { TeammateMood } from "@tabs/contracts";

/** Where the eyes point for a mood, in artwork units from centre. */
export function moodLook(mood: TeammateMood): { x: number; y: number } | undefined {
  switch (mood) {
    case "needsYou":
      return { x: 0, y: 6 };
    case "error":
      return { x: 0, y: 3 };
    default:
      return undefined;
  }
}
