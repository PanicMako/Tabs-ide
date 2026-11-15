import { useEffect } from "react";
import {
  forgetCodePrewarmProject,
  prewarmCodeHost,
  rememberCodePrewarmProject,
} from "../lib/codeHostPrewarm";

/**
 * Keep the Code workbench for the active project warm, and remember that project so
 * the next launch can start its editor while the splash is still showing.
 *
 * A project with the Code tool turned off gets none of this: its editor is shut down
 * if one was running, and it is forgotten so no editor starts for it on launch.
 */
export function useCodeHostPrewarm(
  project: { id: string; cwd: string } | null,
  enabled: boolean,
  openProjectIds: readonly string[],
): void {
  const projectId = project?.id ?? null;
  const workspaceRoot = project?.cwd ?? null;
  useEffect(() => {
    if (!projectId || !workspaceRoot) return;
    if (enabled) {
      rememberCodePrewarmProject({ id: projectId, cwd: workspaceRoot });
      void prewarmCodeHost({ id: projectId, cwd: workspaceRoot });
      return;
    }
    forgetCodePrewarmProject();
    // Closes only sessions missing from the list, so this ends this project's editor.
    void window.desktopBridge
      ?.syncCodeSessions(openProjectIds.filter((id) => id !== projectId))
      .catch(() => undefined);
    // Re-run when the tool is toggled or the project changes, not on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, workspaceRoot]);
}
