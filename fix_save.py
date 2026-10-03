import re

file_path = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Replace buildCustomProcessToolsFromDrafts and saveServerProcesses
build_and_save_pattern = r'const buildCustomProcessToolsFromDrafts = \([\s\S]*?const saveServerProcesses = \(\) => \{[\s\S]*?\}\);[\s\S]*?\}\);[\s\S]*?\};'

# Wait, let's just do it with simple string replacements for whatever is left!
content = content.replace('serverProcessDrafts', 'terminalProcessDrafts')
content = content.replace('setServerProcessDrafts', 'setTerminalProcessDrafts')
content = content.replace('saveServerProcesses', 'saveTerminalProcesses')
content = content.replace('removeServerProcessDraft', 'removeTerminalProcessDraft')
content = content.replace('updateServerProcessDraft', 'updateTerminalProcessDraft')

# Wait, earlier I replaced serverProcessesDirty with terminalProcessesDirty and serverPresetsDirty.
content = content.replace('serverProcessesDirty', 'terminalProcessesDirty')

# Now I need to duplicate the UI for serverPresets.
# Let's find the Terminal Tabs UI block, and duplicate it for Server Presets.
# If I already appended Server Presets earlier, I should remove it and re-add it?
# Let's just fix the variables first.

with open(file_path, "w") as f:
    f.write(content)
