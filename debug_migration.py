import re

file_path = "apps/web/src/workspaceShellStore.ts"

with open(file_path, "r") as f:
    content = f.read()

# Add a console log to decodeProjectWorkspaceSettings
content = content.replace(
    '// Idempotent Migration',
    'console.log("Decoding input:", JSON.stringify(input));\n  // Idempotent Migration'
)

with open(file_path, "w") as f:
    f.write(content)
