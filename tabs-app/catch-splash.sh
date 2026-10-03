#!/usr/bin/env bash

for i in {1..50}; do
  echo "--- RUN $i ---"
  
  # Ensure clean slate
  pkill -9 -f "tabs-dev-root" || true
  pkill -9 -f "dist-electron/main.js" || true
  pkill -9 -f "apps/server/dist/index.mjs" || true
  
  sleep 1
  
  # Launch in background
  bun run dev:desktop > slider-debug.log 2>&1 &
  DEV_PID=$!
  
  # Wait 12 seconds for startup and potential splash
  sleep 12
  
  # Check if stuck
  node check-splash-dom.cjs
  STATUS=$?
  
  if [ $STATUS -eq 0 ]; then
    echo "🚨 STUCK SPLASH DETECTED on run $i!"
    cat slider-debug.log | grep "WS RECONNECT"
    exit 0
  fi
  
  echo "Run $i healthy (or CDP failed). Killing and restarting..."
  pkill -9 -f "tabs-dev-root" || true
  pkill -9 -f "dist-electron/main.js" || true
  pkill -9 -f "apps/server/dist/index.mjs" || true
  sleep 2
done
echo "Finished 20 runs."
