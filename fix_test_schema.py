import re

file_path = "apps/web/src/workspaceShellStore.test.ts"

with open(file_path, "r") as f:
    content = f.read()

old_server_processes = """          serverProcesses: [
            {
              id: "frontend",
              label: "Frontend",
              commands: ["npm run dev"],
              cwd: "",
              env: {},
              autoStart: false,
            },
          ],"""

new_terminal_processes = """          terminalProcesses: [
            {
              id: "frontend",
              label: "Frontend",
              commands: ["npm run dev"],
              cwd: "",
              env: {},
              autoStart: false,
            },
          ],
          serverPresets: [],"""

content = content.replace(old_server_processes, new_terminal_processes)

with open(file_path, "w") as f:
    f.write(content)
