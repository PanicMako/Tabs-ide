import { GroupedDesign } from "./GroupedDesign";
import type { CompanionDesignProps } from "./shared";
import "./designs.css";

export type { CompanionDesignProps };

/** The side panel: one switcher for every surface, page tabs, and the launcher as its home. */
export function CompanionDesignShell(props: CompanionDesignProps) {
  return <GroupedDesign {...props} />;
}
