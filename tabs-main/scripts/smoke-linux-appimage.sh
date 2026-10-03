#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: $0 path/to/Tabs.AppImage" >&2
  exit 2
fi

appimage="$(realpath "$1")"
smoke_root="$(mktemp -d)"
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill -- "-$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_root"
}
trap cleanup EXIT

export TABS_HOME="$smoke_root/home"
export TABS_DESKTOP_USER_DATA_DIR="$smoke_root/electron-profile"
export TABS_DISABLE_AUTO_UPDATE=1
log_file="$TABS_HOME/userdata/logs/desktop-main.log"
launch_output="$smoke_root/launch-output.log"

chmod +x "$appimage"
setsid xvfb-run -a "$appimage" --appimage-extract-and-run --no-sandbox >"$launch_output" 2>&1 &
app_pid=$!

for ((attempt = 1; attempt <= 24; attempt++)); do
  sleep 5
  if [[ -f "$log_file" ]] && grep -Fq "bootstrap native Code-OSS main-process backend started" "$log_file"; then
    echo "AppImage launched with its bundled editor backend."
    exit 0
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    break
  fi
done

echo "AppImage failed to start its bundled editor backend within 120 seconds." >&2
if [[ -f "$log_file" ]]; then tail -100 "$log_file" >&2; fi
if [[ -f "$launch_output" ]]; then tail -100 "$launch_output" >&2; fi
exit 1
