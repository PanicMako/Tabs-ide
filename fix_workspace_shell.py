import re

file_path = "apps/web/src/components/WorkspaceShell.tsx"
with open(file_path, "r") as f:
    content = f.read()

# Fix 1: presetDrafts type in WorkspaceShell.tsx
preset_draft_type_pattern = r'const \[presetDrafts, setPresetDrafts\] = useState<\n    \{\n      id: string;\n      label: string;\n      commands: string\[\];\n      cwd: string;\n      autoStart: boolean;\n      previewUrl\?: string;\n      autoOpenPreview\?: boolean;\n      previewOpenTarget\?: "in-app" \| "external";\n      previewFocus\?: boolean;\n      dependsOn\?: string\[\];\n    \}\[\]\n  >\(\[\]\);'
new_preset_draft_type = """  const [presetDrafts, setPresetDrafts] = useState<
    {
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string | undefined;
      autoOpenPreview?: boolean | undefined;
      previewOpenTarget?: "in-app" | "external" | undefined;
      previewFocus?: boolean | undefined;
      dependsOn?: string[] | undefined;
    }[]
  >([]);"""
content = re.sub(preset_draft_type_pattern, new_preset_draft_type, content, flags=re.DOTALL)

# Fix 2: dependsOn mapping (if necessary, but with the type fix it shouldn't error on previewUrl, but dependsOn is readonly string[] vs string[])
depends_on_pattern = r'dependsOn: process\.dependsOn,'
new_depends_on = r'dependsOn: process.dependsOn ? [...process.dependsOn] : undefined,'
content = re.sub(depends_on_pattern, new_depends_on, content)

# Fix 3: autoStart useEffect
auto_start_effect_pattern = r'const customProcessIds = new Set\(\n      activeProjectSettings\.tools\.flatMap\(\(tool\) =>\n        tool\.kind === "custom_process" && tool\.serverProcessId != null\n          \? \[tool\.serverProcessId\]\n          : \[\],\n      \),\n    \);\n    for \(const process of \[\.\.\.activeProjectSettings\.terminalProcesses, \.\.\.activeProjectSettings\.serverPresets\]\) \{\n      if \(customProcessIds\.has\(process\.id\)\) continue;'
new_auto_start_effect = """for (const process of activeProjectSettings.serverPresets) {"""
content = re.sub(auto_start_effect_pattern, new_auto_start_effect, content, flags=re.DOTALL)

# Fix 4: another customProcessIds block?
other_custom_process_pattern = r'const customProcessIds = new Set\(\n    projectSettings\.tools\.flatMap\(\(tool\) =>\n      tool\.kind === "custom_process" && tool\.serverProcessId != null\n        \? \[tool\.serverProcessId\]\n        : \[\],\n    \),\n  \);\n\n  const hasIncompletePreset = projectSettings\.serverProcesses\.\.\.'
# The error was at 9367: projectSettings.tools.flatMap((tool) => tool.kind === "custom_process" && tool.serverProcessId != null
# We need to find this and remove it. The code around 9367 might be slightly different.
# Let's just blindly replace tool.serverProcessId with tool.terminalProcessId anywhere else to fix the TS errors!
content = content.replace("tool.serverProcessId != null", "tool.terminalProcessId != null")
content = content.replace("[tool.serverProcessId]", "[tool.terminalProcessId]")
content = content.replace("projectSettings.serverProcesses", "projectSettings.serverPresets")

with open(file_path, "w") as f:
    f.write(content)
