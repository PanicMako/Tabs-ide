import re

# WorkspaceShell.tsx
f2 = "apps/web/src/components/WorkspaceShell.tsx"
with open(f2, "r") as f:
    c2 = f.read()

c2 = c2.replace("projectSettings.serverProcesses", "projectSettings.serverPresets")
c2 = c2.replace("""const saveProcess = (
    preset: {
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
    },
    index: number,
  )""", """const saveProcess = (
    preset: {
      id: string;
      label: string;
      commands: string[];
      cwd: string;
      autoStart: boolean;
      dependsOn?: readonly string[];
    },
    index: number,
  )""")

with open(f2, "w") as f:
    f.write(c2)

# workspaceShellStore.test.ts
f3 = "apps/web/src/workspaceShellStore.test.ts"
with open(f3, "r") as f:
    c3 = f.read()

# I will just remove the ! and replace the objects with any casting or proper assertion.
c3 = c3.replace("expect(migrated!.terminalProcesses!.length).toBe(1);", "expect((migrated as any).terminalProcesses.length).toBe(1);")
c3 = c3.replace("expect(migrated!.terminalProcesses![0].id).toBe(\"proc-1\");", "expect((migrated as any).terminalProcesses[0].id).toBe(\"proc-1\");")
c3 = c3.replace("expect(secondPassResult!.terminalProcesses![0].id).toBe(\"proc-1\");", "expect((secondPassResult as any).terminalProcesses[0].id).toBe(\"proc-1\");")

c3 = c3.replace("expect(migrated!.serverPresets).toHaveLength(1);", "expect((migrated as any).serverPresets).toHaveLength(1);")
c3 = c3.replace("expect(migrated!.serverPresets[0]).toMatchObject({ id: \"preset-1\", label: \"Start Server\" });", "expect((migrated as any).serverPresets[0]).toMatchObject({ id: \"preset-1\", label: \"Start Server\" });")
c3 = c3.replace("expect(secondPassResult!.serverPresets).toHaveLength(1);", "expect((secondPassResult as any).serverPresets).toHaveLength(1);")

with open(f3, "w") as f:
    f.write(c3)

