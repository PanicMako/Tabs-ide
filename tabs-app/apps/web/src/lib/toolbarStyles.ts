import type { ToolbarStyle } from "@tabs/contracts/settings";

// Keep persisted IDs so these preferences also work in older Tabs builds.
export const TOOLBAR_STYLES = [
  {
    id: "solid",
    label: "Elevated Solid",
    description: "A solid accent that slides between tools.",
  },
  {
    id: "ghost-mesh",
    label: "Aurora",
    description: "Soft fields of theme color inside the active tool.",
  },
  {
    id: "spotlight",
    label: "Rim Light",
    description: "A fine edge of light traces the active tool.",
  },
  {
    id: "refraction",
    label: "Frosted Lens",
    description: "A glass lens glides over a dotted track.",
  },
  { id: "titanium", label: "Soft Clay", description: "A softly raised pill with a tactile edge." },
  { id: "dot", label: "Ghost Outline", description: "A light outline frames the active tool." },
  {
    id: "material",
    label: "Focus Pull",
    description: "The active tool comes forward while the others recede.",
  },
] as const satisfies readonly { id: ToolbarStyle; label: string; description: string }[];

export function resolveToolbarStyle(style: ToolbarStyle) {
  switch (style) {
    case "linear-edge":
      return "dot";
    case "traveling-border":
      return "spotlight";
    case "groove":
      return "titanium";
    default:
      return style;
  }
}
