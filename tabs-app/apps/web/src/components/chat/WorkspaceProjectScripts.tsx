import type { ProjectScript, ResolvedKeybindingsConfig } from "@tabs/contracts";
import type { Project } from "../../types";
import { environmentApi } from "../../connection/environmentApiRegistry";
import { newCommandId } from "../../lib/utils";
import { commandForProjectScript, nextProjectScriptId } from "../../projectScripts";
import { keybindingValueForCommand } from "../../lib/projectScriptKeybindings";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";

/** Keeps panel actions on the project's owning machine and existing project configuration. */
export function WorkspaceProjectScripts({
  project,
  keybindings,
  onRunScript,
}: {
  project: Project;
  keybindings: ResolvedKeybindingsConfig;
  onRunScript: (script: ProjectScript) => void;
}) {
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
      displayMode="panel"
      scripts={[...project.scripts]}
      keybindings={keybindings}
      onRunScript={onRunScript}
      onAddScript={async (input) => {
        const id = nextProjectScriptId(
          input.name,
          project.scripts.map((script) => script.id),
        );
        const { keybinding: _keybinding, ...script } = input;
        await save([...project.scripts, { ...script, id }], id, input);
      }}
      onUpdateScript={async (id, input) => {
        const { keybinding: _keybinding, ...script } = input;
        await save(
          project.scripts.map((current) => (current.id === id ? { ...script, id } : current)),
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
