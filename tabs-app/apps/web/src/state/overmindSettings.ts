import type { SubagentModelSettings } from "@tabs/contracts";
import { DEFAULT_SUBAGENT_MODEL_SETTINGS } from "@tabs/shared/subagents";

import { applySettingsUpdate, useSettings } from "../hooks/useSettings";

/**
 * Which models run sub-agents. Lives in server settings: the server enforces
 * it whenever a sub-agent starts (plain delegation and Overmind alike), and
 * every device attached to the same server sees the same choice.
 */
export function useSubagentModels(): SubagentModelSettings {
  return useSettings((settings) => settings.subagentModels ?? DEFAULT_SUBAGENT_MODEL_SETTINGS);
}

/** Saves the whole choice; the server replaces it rather than merging. */
export function setSubagentModels(next: SubagentModelSettings): Promise<boolean> {
  return applySettingsUpdate({ subagentModels: next });
}
