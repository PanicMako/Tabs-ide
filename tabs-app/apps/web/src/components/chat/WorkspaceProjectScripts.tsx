import type {
  ProjectScript,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@tabs/contracts";
import type { Project } from "../../types";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  releaseClaimedRoles,
} from "../../projectScripts";
import { keybindingValueForCommand } from "../../lib/projectScriptKeybindings";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";

/** Keeps panel actions on the project's owning machine and existing project configuration. */
export function WorkspaceProjectScripts({
  project,
  cwd,
  keybindings,
  fileScripts,
  onRunScript,
  displayMode = "panel",
}: {
  displayMode?: "panel" | "list";
  project: Project;
  cwd?: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  onRunScript: (script: ProjectScript) => void;
}) {
  const autoFileScripts = useT3ProjectFileScripts(project.environmentId, cwd ?? project.cwd);
  const effectiveFileScripts = fileScripts ?? autoFileScripts;

  const save = async (scripts: ProjectScript[], id: string, input?: NewProjectScriptInput) => {
    const api = await environmentApi(project.environmentId);
    const command = commandForProjectScript(id);
    const previousKey = keybindingValueForCommand(keybindings, command);
    await api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId: project.id,
      scripts,
    });
    if (input?.keybinding) {
      await api.server.upsertKeybinding({
        key: input.keybinding,
        command,
        ...(previousKey ? { replace: { key: previousKey, command } } : {}),
      });
    } else if (previousKey) {
      await api.server.removeKeybinding({ key: previousKey, command });
    }
  };
  return (
    <ProjectScriptsControl
      displayMode={displayMode}
      scripts={[...project.scripts]}
      fileScripts={effectiveFileScripts}
      keybindings={keybindings}
      onRunScript={onRunScript}
      onAddScript={async (input) => {
        const id = nextProjectScriptId(
          input.name,
          project.scripts.map((script) => script.id),
        );
        await save(
          [
            ...project.scripts.map((script) => releaseClaimedRoles(script, input)),
            buildProjectScript(id, input),
          ],
          id,
          input,
        );
      }}
      onUpdateScript={async (id, input) => {
        await save(
          project.scripts.map((current) =>
            current.id === id ? buildProjectScript(id, input) : releaseClaimedRoles(current, input),
          ),
          id,
          input,
        );
      }}
      onDeleteScript={async (id) =>
        save(
          project.scripts.filter((script) => script.id !== id),
          id,
        )
      }
    />
  );
}
