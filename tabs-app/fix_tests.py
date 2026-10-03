import re

file_path = "apps/web/src/workspaceShellStore.test.ts"

with open(file_path, "r") as f:
    content = f.read()

# Remove the standalone describe block
standalone_test = """describe("Migration of legacy serverProcesses", () => {
  it("migrates legacy serverProcesses into terminalProcesses and serverPresets", () => {
    const store = useWorkspaceShellStore.getState();
    const projectId = "test-migration" as any;
    const legacyPayload = {
      tools: [
        {
          id: "tool-1",
          kind: "custom_process",
          label: "Frontend",
          visible: true,
          serverProcessId: "proc-1"
        },
        {
          id: "server",
          kind: "server",
          label: "Server",
          visible: true
        }
      ],
      serverProcesses: [
        {
          id: "proc-1",
          label: "Frontend Dev",
          commands: ["npm run dev"],
          cwd: "/tmp",
          autoStart: false
        },
        {
          id: "proc-2",
          label: "My Preset",
          commands: ["npm run build"],
          cwd: "/tmp",
          autoStart: false
        }
      ]
    };

    // Upsert the raw legacy payload
    store.upsertProjectSettings(projectId, legacyPayload as any);

    const migrated = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
    expect(migrated).toBeDefined();
    
    // Check tools got migrated to use terminalProcessId
    const customTool = migrated.tools.find((t) => t.id === "tool-1");
    expect(customTool).toBeDefined();
    expect((customTool as any).serverProcessId).toBeUndefined();
    expect((customTool as any).terminalProcessId).toBe("proc-1");

    // Check processes were bucketed correctly
    expect(migrated.terminalProcesses.length).toBe(1);
    expect(migrated.terminalProcesses[0].id).toBe("proc-1");
    expect(migrated.serverPresets.length).toBe(1);
    expect(migrated.serverPresets[0].id).toBe("proc-2");

    // Check idempotency: upsert the exact same migrated object again
    const secondPass = { ...migrated };
    store.upsertProjectSettings(projectId, secondPass);

    const secondPassResult = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
    expect(secondPassResult.terminalProcesses.length).toBe(1);
    expect(secondPassResult.serverPresets.length).toBe(1);
    expect(secondPassResult.terminalProcesses[0].id).toBe("proc-1");
  });
});
"""
content = content.replace(standalone_test, "")

# Insert it at the end of the main describe block (before the last `});`)
test_body = """
  it("migrates legacy serverProcesses into terminalProcesses and serverPresets", () => {
    const store = useWorkspaceShellStore.getState();
    const projectId = ProjectId.makeUnsafe("test-migration");
    const legacyPayload = {
      tools: [
        {
          id: "tool-1",
          kind: "custom_process",
          label: "Frontend",
          visible: true,
          serverProcessId: "proc-1"
        },
        {
          id: "server",
          kind: "server",
          label: "Server",
          visible: true
        }
      ],
      serverProcesses: [
        {
          id: "proc-1",
          label: "Frontend Dev",
          commands: ["npm run dev"],
          cwd: "/tmp",
          autoStart: false
        },
        {
          id: "proc-2",
          label: "My Preset",
          commands: ["npm run build"],
          cwd: "/tmp",
          autoStart: false
        }
      ]
    };

    // Upsert the raw legacy payload
    store.upsertProjectSettings(projectId, legacyPayload as any);

    const migrated = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
    expect(migrated).toBeDefined();
    
    // Check tools got migrated to use terminalProcessId
    const customTool = migrated.tools.find((t) => t.id === "tool-1");
    expect(customTool).toBeDefined();
    expect((customTool as any).serverProcessId).toBeUndefined();
    expect((customTool as any).terminalProcessId).toBe("proc-1");

    // Check processes were bucketed correctly
    expect(migrated.terminalProcesses.length).toBe(1);
    expect(migrated.terminalProcesses[0].id).toBe("proc-1");
    expect(migrated.serverPresets.length).toBe(1);
    expect(migrated.serverPresets[0].id).toBe("proc-2");

    // Check idempotency: upsert the exact same migrated object again
    const secondPass = { ...migrated };
    store.upsertProjectSettings(projectId, secondPass);

    const secondPassResult = useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId];
    expect(secondPassResult.terminalProcesses.length).toBe(1);
    expect(secondPassResult.serverPresets.length).toBe(1);
    expect(secondPassResult.terminalProcesses[0].id).toBe("proc-1");
  });
});
"""

# Replace the last `});` with the test body
content = content.rstrip()
if content.endswith("});"):
    content = content[:-3] + test_body

with open(file_path, "w") as f:
    f.write(content)
