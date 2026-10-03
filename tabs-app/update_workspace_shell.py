import re

file_path = "apps/web/src/components/WorkspaceShell.tsx"

with open(file_path, "r") as f:
    content = f.read()

# 1. Update CustomProcessTool props
content = content.replace(
    'process: ProjectWorkspaceSettings["serverProcesses"][number];',
    'process: ProjectWorkspaceSettings["terminalProcesses"][number];'
)

# 2. Update ServerTool presets resolution logic
old_server_tool_processes = """  // Server presets and custom "terminal tab" embeds share one `serverProcesses`
  // array (a custom_process tool references its process via `serverProcessId`).
  // The Server tab must only surface presets the user added *here* — never the
  // processes that back standalone terminal tabs (e.g. gemini/claude).
  const processes = useMemo(() => {
    const customProcessIds = new Set(
      props.projectSettings.tools.flatMap((tool) =>
        tool.kind === "custom_process" && tool.serverProcessId != null
          ? [tool.serverProcessId]
          : [],
      ),
    );
    return props.projectSettings.serverProcesses.filter(
      (process) => !customProcessIds.has(process.id),
    );
  }, [props.projectSettings.serverProcesses, props.projectSettings.tools]);"""

new_server_tool_processes = """  const processes = props.projectSettings.serverPresets;"""

content = content.replace(old_server_tool_processes, new_server_tool_processes)

# 3. Fix hasIncompletePreset logic
old_has_incomplete = """    const hasAnyValue =
      preset.label.trim().length > 0 ||
      preset.cwd.trim().length > 0 ||
      preset.autoStart ||
      preset.commands.some((command) => command.trim().length > 0);
    return (
      hasAnyValue && (normalizedPreset.label.length === 0 || normalizedPreset.commands.length === 0)
    );"""

new_has_incomplete = """    // The auto-filled cwd does NOT count toward "this preset has been started."
    const hasAnyValue =
      preset.label.trim().length > 0 ||
      preset.commands.some((command) => command.trim().length > 0);
    return (
      hasAnyValue && (normalizedPreset.label.length === 0 || normalizedPreset.commands.length === 0)
    );"""

content = content.replace(old_has_incomplete, new_has_incomplete)

# 4. activeTool?.kind === "custom_process" logic
content = content.replace(
    'activeTool?.kind === "custom_process" ? (activeTool.serverProcessId ?? null) : null;',
    'activeTool?.kind === "custom_process" ? (activeTool.terminalProcessId ?? null) : null;'
)

# 5. runCustomProcess arguments
content = content.replace(
    'async (process: ProjectWorkspaceSettings["serverProcesses"][number], threadId: ThreadId) => {',
    'async (process: ProjectWorkspaceSettings["terminalProcesses"][number] | ProjectWorkspaceSettings["serverPresets"][number], threadId: ThreadId) => {'
)

# 6. activeProjectSettings.serverProcesses loops
content = content.replace(
    'for (const process of activeProjectSettings.serverProcesses) {',
    'for (const process of [...activeProjectSettings.terminalProcesses, ...activeProjectSettings.serverPresets]) {'
)

# 7. handleSavePresets callback logic
old_save_presets = """              serverProcesses: [
                ...current.serverProcesses.filter((process) => customProcessIds.has(process.id)),
                ...presets.map((preset) => ({
                  id: preset.id,
                  label: preset.label.trim().length > 0 ? preset.label.trim() : "Untitled Preset",
                  command: undefined,
                  commands: preset.commands.map((c) => c.trim()).filter((c) => c.length > 0),
                  cwd: preset.cwd.trim().length > 0 ? preset.cwd.trim() : activeProject.cwd,
                  env: {},
                  autoStart: preset.autoStart,
                  previewUrl: preset.previewUrl,
                  autoOpenPreview: preset.autoOpenPreview,
                  previewOpenTarget: preset.previewOpenTarget,
                })),
              ],"""

new_save_presets = """              serverPresets: [
                ...presets.map((preset) => ({
                  id: preset.id,
                  label: preset.label.trim().length > 0 ? preset.label.trim() : "Untitled Preset",
                  command: undefined,
                  commands: preset.commands.map((c) => c.trim()).filter((c) => c.length > 0),
                  cwd: preset.cwd.trim().length > 0 ? preset.cwd.trim() : activeProject.cwd,
                  env: {},
                  autoStart: preset.autoStart,
                  previewUrl: preset.previewUrl,
                  autoOpenPreview: preset.autoOpenPreview,
                  previewOpenTarget: preset.previewOpenTarget,
                })),
              ],"""

content = content.replace(old_save_presets, new_save_presets)

# Remove customProcessIds logic inside handleSavePresets since it's obsolete
old_custom_process_ids = """              const customProcessIds = new Set(
                current.tools.flatMap((tool) =>
                  tool.kind === "custom_process" && tool.serverProcessId != null
                    ? [tool.serverProcessId]
                    : [],
                ),
              );
"""
content = content.replace(old_custom_process_ids, "")


# 8. onRunProcess process finding
old_on_run = """      const process = activeProjectSettings.serverProcesses.find((entry) => entry.id === processId);"""
new_on_run = """      const process = [...activeProjectSettings.terminalProcesses, ...activeProjectSettings.serverPresets].find((entry) => entry.id === processId);"""
content = content.replace(old_on_run, new_on_run)

# 9. useCommandShortcut "Server tool processes"
old_shortcut = """                  activeProjectSettings.serverProcesses.map((p) => [p.id, p.label]),"""
new_shortcut = """                  [...activeProjectSettings.terminalProcesses, ...activeProjectSettings.serverPresets].map((p) => [p.id, p.label]),"""
content = content.replace(old_shortcut, new_shortcut)

# 10. customProcessTool definition
old_custom_process_tool = """  const customProcessTool =
    activeProject &&
    activeProjectSettings &&
    activeTool?.kind === "custom_process" &&
    customProcessThreadId
      ? (() => {
          const process = activeTool.serverProcessId
            ? (activeProjectSettings.serverProcesses.find(
                (entry) => entry.id === activeTool.serverProcessId,
              ) ?? null)
            : null;"""

new_custom_process_tool = """  const customProcessTool =
    activeProject &&
    activeProjectSettings &&
    activeTool?.kind === "custom_process" &&
    customProcessThreadId
      ? (() => {
          const process = activeTool.terminalProcessId
            ? (activeProjectSettings.terminalProcesses.find(
                (entry) => entry.id === activeTool.terminalProcessId,
              ) ?? null)
            : null;"""

content = content.replace(old_custom_process_tool, new_custom_process_tool)


with open(file_path, "w") as f:
    f.write(content)

print("WorkspaceShell.tsx updated successfully.")
