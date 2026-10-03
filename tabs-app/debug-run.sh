#!/bin/bash
# Start logging ps aux in the background
TRACELOG="/Users/rushil.dev/Desktop/Tabs-ide-cleanup-vscode-web-2026-04-28/tabs-app/ps-trace.log"
echo "Starting process trace..." > "$TRACELOG"
(
  for i in {1..200}; do
    echo "=== TIME $(date +%H:%M:%S.%N) ===" >> "$TRACELOG"
    ps aux | grep -iE "tabs|electron|turbo|dev-runner|vite|node" | grep -v grep >> "$TRACELOG"
    sleep 0.05
  done
) &
PS_PID=$!

# Run the command and capture its output
bun run dev:desktop > /Users/rushil.dev/Desktop/Tabs-ide-cleanup-vscode-web-2026-04-28/tabs-app/command-run.log 2>&1
EXIT_CODE=$?

# Stop logging
kill -9 $PS_PID

echo "Finished with exit code: $EXIT_CODE"
