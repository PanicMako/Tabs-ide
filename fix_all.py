import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix 1: dirty tracking
dirty_pattern = r'const serverProcessesDirty = useMemo\(\n.*?\[serverProcessDrafts\],\n  \);'
new_dirty = """  const terminalProcessesDirty = useMemo(
    () => terminalProcessDrafts.some(isServerProcessDraftDirty),
    [terminalProcessDrafts],
  );

  const serverPresetsDirty = useMemo(
    () => serverPresetDrafts.some(isServerProcessDraftDirty),
    [serverPresetDrafts],
  );"""
content = re.sub(dirty_pattern, new_dirty, content, flags=re.DOTALL)

# Fix 2: saveServerProcesses -> saveTerminalProcesses and saveServerPresets
# And buildCustomProcessToolsFromDrafts
build_tools_pattern = r'const buildCustomProcessToolsFromDrafts = \([\s\S]*?const saveServerProcesses = \(\) => \{[\s\S]*?\}\);[\s\S]*?\};'
new_save = """  const buildCustomProcessToolsFromDrafts = (
    drafts: ServerProcessDraft[],
  ): ProjectToolDefinition[] => {
    const validDrafts = drafts.filter(
      (draft) => draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
    );

    return validDrafts.map((draft) => ({
      id: createServerProcessToolId(draft.id),
      kind: "custom_process" as const,
      label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
      visible: draft.visible,
      terminalProcessId: draft.id,
    }));
  };

  const saveTerminalProcesses = () => {
    upsertProjectSettings(projectId, (current) => {
      const validDrafts = terminalProcessDrafts.filter(
        (draft) =>
          draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
      );

      const nextTerminalProcesses = validDrafts.map((draft) => ({
        id: draft.id,
        label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled terminal",
        commands: draft.commands.map((c) => c.trim()).filter((c) => c.length > 0),
        cwd: draft.cwd.trim().length > 0 ? draft.cwd.trim() : current.cwd,
        env: {},
        autoStart: draft.autoStart,
      }));

      return {
        ...current,
        terminalProcesses: nextTerminalProcesses,
        tools: mergeToolGroup(
          current.tools,
          buildCustomProcessToolsFromDrafts(terminalProcessDrafts),
          "custom_process",
          "server",
        ),
      };
    });
  };

  const saveServerPresets = () => {
    upsertProjectSettings(projectId, (current) => {
      const validDrafts = serverPresetDrafts.filter(
        (draft) =>
          draft.label.trim().length > 0 || draft.commands.some((c) => c.trim().length > 0),
      );

      const nextServerPresets = validDrafts.map((draft) => ({
        id: draft.id,
        label: draft.label.trim().length > 0 ? draft.label.trim() : "Untitled preset",
        commands: draft.commands.map((c) => c.trim()).filter((c) => c.length > 0),
        cwd: draft.cwd.trim().length > 0 ? draft.cwd.trim() : current.cwd,
        env: {},
        autoStart: draft.autoStart,
      }));

      return {
        ...current,
        serverPresets: nextServerPresets,
      };
    });
  };"""

content = re.sub(build_tools_pattern, new_save, content, flags=re.DOTALL)

# Fix 3: useEffect deps
content = content.replace("serverProcessDrafts,", "terminalProcessDrafts, serverPresetDrafts,")
content = content.replace("serverProcessesDirty,", "terminalProcessesDirty, serverPresetsDirty,")

# Fix 4: remaining serverProcessDrafts in UI
content = content.replace("serverProcessDrafts.some", "terminalProcessDrafts.some")

with open(file_path, "w") as f:
    f.write(content)
