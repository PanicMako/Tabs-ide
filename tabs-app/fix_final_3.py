import re

# WorkspaceShell.tsx
f2 = "apps/web/src/components/WorkspaceShell.tsx"
with open(f2, "r") as f:
    c2 = f.read()

# Fix updatePresetRow type
old_update_row = """      updater: (preset: {
        id: string;
        label: string;
        commands: string[];
        cwd: string;
        autoStart: boolean;
        previewUrl?: string;
        autoOpenPreview?: boolean;
        previewOpenTarget?: "in-app" | "external";
        previewFocus?: boolean;
        dependsOn?: string[];
      }) => {"""
new_update_row = """      updater: (preset: {
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
      }) => {"""
c2 = c2.replace(old_update_row, new_update_row)

old_update_row_ret = """      }) => {
        id: string;
        label: string;
        commands: string[];
        cwd: string;
        autoStart: boolean;
        previewUrl?: string;
        autoOpenPreview?: boolean;
        previewOpenTarget?: "in-app" | "external";
        previewFocus?: boolean;
        dependsOn?: string[];
      },"""
new_update_row_ret = """      }) => {
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
      },"""
c2 = c2.replace(old_update_row_ret, new_update_row_ret)

# Fix 9379: projectSettings.serverProcesses
c2 = c2.replace("projectSettings.serverProcesses", "projectSettings.serverPresets")

with open(f2, "w") as f:
    f.write(c2)

# workspaceShellStore.test.ts
f3 = "apps/web/src/workspaceShellStore.test.ts"
with open(f3, "r") as f:
    c3 = f.read()

# Just put '!' everywhere around line 378
c3 = c3.replace("expect((migrated as any).serverPresets[0].id).toBe(\"proc-2\");", "expect((migrated as any).serverPresets[0]?.id).toBe(\"proc-2\");")

with open(f3, "w") as f:
    f.write(c3)

