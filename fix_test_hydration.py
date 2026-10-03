import re

file_path = "apps/web/src/workspaceShellStore.test.ts"

with open(file_path, "r") as f:
    content = f.read()

old_test_setup = """    // Upsert the raw legacy payload
    store.upsertProjectSettings(projectId, legacyPayload as any);"""

new_test_setup = """    // Inject the legacy payload directly into the state to simulate hydration from localStorage
    useWorkspaceShellStore.setState((state) => ({
      ...state,
      projectSettingsByProjectId: {
        ...state.projectSettingsByProjectId,
        [projectId]: legacyPayload as any,
      },
    }));

    // Trigger an upsert to run decodeProjectWorkspaceSettings
    store.upsertProjectSettings(projectId, (current) => current);"""

content = content.replace(old_test_setup, new_test_setup)

with open(file_path, "w") as f:
    f.write(content)
