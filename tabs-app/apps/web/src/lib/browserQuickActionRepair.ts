import {
  BrowserQuickAction,
  ProjectId,
  type BrowserQuickActionVerifiedRepair,
} from "@tabs/contracts";
import { ProjectWorkspaceSettings } from "@tabs/contracts/settings";
import * as Schema from "effect/Schema";
import {
  readPersistedProjectWorkspaceSettings,
  useWorkspaceShellStore,
} from "../workspaceShellStore";

const sameAction = Schema.toEquivalence(BrowserQuickAction);
const sameSettings = Schema.toEquivalence(ProjectWorkspaceSettings);

export function saveVerifiedBrowserQuickActionRepair(
  projectId: string,
  { previous, replacement }: BrowserQuickActionVerifiedRepair,
): boolean {
  if (previous.id !== replacement.id) return false;

  const id = ProjectId.makeUnsafe(projectId);
  const workspace = useWorkspaceShellStore.getState();
  const settings = workspace.projectSettingsByProjectId[id];
  const actions = settings?.browserQuickActions;
  if (!actions) return false;
  const [saved, ...duplicates] = actions.filter((action) => action.id === previous.id);
  if (!saved || duplicates.length || !sameAction(saved, previous)) return false;

  // A popout can update storage while this renderer still holds an older project snapshot.
  const persisted = readPersistedProjectWorkspaceSettings(id);
  if (!persisted || !sameSettings(settings, persisted)) return false;

  const browserQuickActions = actions.map((action) => (action === saved ? replacement : action));
  try {
    workspace.upsertProjectSettings(id, { browserQuickActions });
    return true;
  } catch (error) {
    const current = useWorkspaceShellStore.getState().projectSettingsByProjectId[id];
    if (
      current &&
      current !== settings &&
      sameSettings(current, { ...settings, browserQuickActions })
    ) {
      // Zustand publishes the update before writing to storage. Restore the prior settings in memory.
      try {
        useWorkspaceShellStore.setState((state) => ({
          projectSettingsByProjectId: { ...state.projectSettingsByProjectId, [id]: settings },
        }));
      } catch {
        // Persistence can still fail after Zustand has applied the rollback.
      }
    }
    console.warn("Could not save the verified browser Quick Action repair.", error);
    return false;
  }
}
