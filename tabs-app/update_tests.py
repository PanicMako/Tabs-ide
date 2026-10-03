import re

file_path = "apps/web/src/workspaceShellStore.test.ts"

with open(file_path, "r") as f:
    content = f.read()

# Replace any lingering serverProcessId
content = content.replace('serverProcessId: "frontend",', 'terminalProcessId: "frontend",')
content = content.replace('serverProcessId: "backend",', 'terminalProcessId: "backend",')
content = content.replace('serverProcesses: []', 'terminalProcesses: [],\n          serverPresets: []')

# We need to add the migration tests to workspaceShellStore.test.ts. Let's see if we can just append it or insert it into a describe block.
# I'll just append a describe block at the end.
migration_test = """
describe("decodeProjectWorkspaceSettings idempotent migration", () => {
  it("should migrate legacy serverProcesses into terminalProcesses and serverPresets correctly", () => {
    // We import decodeProjectWorkspaceSettings Schema to test decoding, or we can use the default export if we exported the decode function.
    // However, decodeProjectWorkspaceSettings is not exported. But upsertProjectSettings uses it!
    // We can simulate an upsert with raw payload or we can just test the schema decode.
    // Wait, since decodeProjectWorkspaceSettings is internal, we can just test by calling `useWorkspaceShellStore.getState().upsertProjectSettings`
    // with a "legacy" payload and seeing what comes out.
  });
});
"""

with open(file_path, "w") as f:
    f.write(content)

print("Tests updated.")
