import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix saveTerminalProcesses assigning to serverProcesses
content = content.replace("serverProcesses: nextServerProcesses", "terminalProcesses: nextServerProcesses")
content = content.replace("resetServerProcesses", "resetTerminalProcesses")
content = content.replace("createServerProcessDrafts(projectSettings)", "createTerminalProcessDrafts(projectSettings)")

# Define the new save/reset functions
save_server_presets = """
  const resetServerPresets = () => {
    setServerPresetDrafts(createServerPresetDrafts(projectSettings));
  };
"""
# insert it after resetTerminalProcesses
content = content.replace("  const resetTerminalProcesses = () => {\n    setTerminalProcessDrafts(createTerminalProcessDrafts(projectSettings));\n  };", "  const resetTerminalProcesses = () => {\n    setTerminalProcessDrafts(createTerminalProcessDrafts(projectSettings));\n  };\n" + save_server_presets)

with open(file_path, "w") as f:
    f.write(content)
