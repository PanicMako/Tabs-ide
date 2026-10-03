import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Replace createServerProcessDrafts completely
create_draft_pattern = r'function createServerProcessDrafts.*?\}\n\nfunction isCustomEmbedDraftDirty'
new_draft_creators = """function createTerminalProcessDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
  return settings.terminalProcesses.map((process) => {
    const tool = settings.tools.find(
      (entry) => entry.kind === "custom_process" && entry.terminalProcessId === process.id,
    );
    return {
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: tool?.visible ?? true,
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: tool?.visible ?? true,
    };
  });
}

function createServerPresetDrafts(settings: ProjectWorkspaceSettings): ServerProcessDraft[] {
  return settings.serverPresets.map((process) => {
    return {
      id: process.id,
      label: process.label,
      commands: process.commands.length > 0 ? [...process.commands] : [""],
      cwd: process.cwd,
      autoStart: process.autoStart,
      visible: true,
      isNew: false,
      originalLabel: process.label,
      originalCommands: process.commands.length > 0 ? [...process.commands] : [""],
      originalCwd: process.cwd,
      originalAutoStart: process.autoStart,
      originalVisible: true,
    };
  });
}

function isCustomEmbedDraftDirty"""

content = re.sub(create_draft_pattern, new_draft_creators, content, flags=re.DOTALL)

with open(file_path, "w") as f:
    f.write(content)

print("Updated create drafts")
