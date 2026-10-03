import re

# 1. ProjectWorkspaceSettingsSection.tsx
f1 = "apps/web/src/components/ProjectWorkspaceSettingsSection.tsx"
with open(f1, "r") as f:
    c1 = f.read()

c1 = c1.replace('entry.kind === "custom_process" && entry.serverProcessId === process.id', 'entry.kind === "custom_process" && entry.terminalProcessId === process.id')

with open(f1, "w") as f:
    f.write(c1)

# 2. WorkspaceShell.tsx
f2 = "apps/web/src/components/WorkspaceShell.tsx"
with open(f2, "r") as f:
    c2 = f.read()

# fix 7126: Object is possibly undefined
# It's probably `newDrafts[0]?.id` or something. Let's just find `newDrafts[newDrafts.length - 1].id` and change it to `newDrafts[newDrafts.length - 1]?.id ?? ""`
c2 = c2.replace("newDrafts[newDrafts.length - 1].id", 'newDrafts[newDrafts.length - 1]?.id ?? ""')

# fix 7271: onSavePresets missing | undefined
on_save_presets_type = """  onSavePresets: (
    presets: Array<{
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string;
      autoOpenPreview?: boolean;
      previewOpenTarget?: "in-app" | "external";
      previewFocus?: boolean;
      dependsOn?: readonly string[];
    }>,
  ) => void;"""
new_on_save_presets_type = """  onSavePresets: (
    presets: Array<{
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      previewUrl?: string | undefined;
      autoOpenPreview?: boolean | undefined;
      previewOpenTarget?: "in-app" | "external" | undefined;
      previewFocus?: boolean | undefined;
      dependsOn?: readonly string[] | undefined;
    }>,
  ) => void;"""
c2 = c2.replace(on_save_presets_type, new_on_save_presets_type)

# fix 7960: dependsOn does not exist on type...
# saveProcess type inside WorkspaceShell
save_process_type = """      commands: string[];
      cwd: string;
      autoStart: boolean;
    }>,"""
new_save_process_type = """      commands: string[];
      cwd: string;
      autoStart: boolean;
      dependsOn?: readonly string[] | undefined;
    }>,"""
c2 = c2.replace(save_process_type, new_save_process_type)

# fix 9369: projectSettings.serverProcesses
c2 = c2.replace("projectSettings.serverProcesses", "projectSettings.serverPresets")

with open(f2, "w") as f:
    f.write(c2)

# 3. workspaceShellStore.test.ts
f3 = "apps/web/src/workspaceShellStore.test.ts"
with open(f3, "r") as f:
    c3 = f.read()

c3 = c3.replace("expect(migrated!.terminalProcesses.length).toBe(1);", "expect(migrated!.terminalProcesses!.length).toBe(1);")
c3 = c3.replace("expect(migrated!.terminalProcesses[0].id).toBe(\"proc-1\");", "expect(migrated!.terminalProcesses![0].id).toBe(\"proc-1\");")
c3 = c3.replace("expect(secondPassResult!.terminalProcesses[0].id).toBe(\"proc-1\");", "expect(secondPassResult!.terminalProcesses![0].id).toBe(\"proc-1\");")

with open(f3, "w") as f:
    f.write(c3)

