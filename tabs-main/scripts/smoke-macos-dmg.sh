#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1" || ( "$2" != "arm64" && "$2" != "x64" ) ]]; then
  echo "Usage: $0 path/to/Tabs.dmg arm64|x64" >&2
  exit 2
fi

dmg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
expected_arch="$2"
binary_arch="arm64"
if [[ "$expected_arch" == "x64" ]]; then binary_arch="x86_64"; fi
smoke_root="$(mktemp -d)"
mount_point="$smoke_root/mount"
app_path="$smoke_root/Tabs.app"
app_pid=""
mounted=0
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ "$mounted" == 1 ]]; then hdiutil detach "$mount_point" -quiet || true; fi
  # GitHub discards the runner after this job. Deleting the copied full runtime
  # here can take longer than the smoke test itself and exceed the job timeout.
  if [[ "${CI:-}" == "true" ]]; then
    echo "Retaining macOS smoke files until runner teardown: $smoke_root"
  else
    rm -rf "$smoke_root"
  fi
}
trap cleanup EXIT

mkdir -p "$mount_point"
hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" "$dmg" -quiet
mounted=1
echo "Mounted DMG at $mount_point"
ditto "$mount_point/Tabs.app" "$app_path"
echo "Copied Tabs.app to $app_path"
hdiutil detach "$mount_point" -quiet
mounted=0
echo "Detached DMG"

binary="$app_path/Contents/MacOS/Tabs"
if [[ ! -x "$binary" ]]; then
  echo "The DMG is missing the Tabs executable." >&2
  exit 1
fi
if ! lipo -archs "$binary" | tr ' ' '\n' | grep -Fxq "$binary_arch"; then
  echo "The DMG executable does not contain $binary_arch." >&2
  exit 1
fi
codesign --verify --deep --strict "$app_path"
echo "Verified macOS app signature"

export TABS_HOME="$smoke_root/home"
export TABS_DESKTOP_USER_DATA_DIR="$smoke_root/electron-profile"
export TABS_DISABLE_AUTO_UPDATE=1
log_file="$TABS_HOME/userdata/logs/desktop-main.log"
launch_output="$smoke_root/launch-output.log"
"$binary" >"$launch_output" 2>&1 &
app_pid=$!
echo "Launched Tabs PID $app_pid"

for ((attempt = 1; attempt <= 24; attempt++)); do
  sleep 5
  if [[ -f "$log_file" ]] && grep -Fq "bootstrap native Code-OSS main-process backend started" "$log_file"; then
    echo "macOS $expected_arch app launched with its bundled editor backend."
    exit 0
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    break
  fi
done

echo "macOS $expected_arch app failed to start its bundled editor backend within 120 seconds." >&2
if [[ -f "$log_file" ]]; then tail -100 "$log_file" >&2; fi
if [[ -f "$launch_output" ]]; then tail -100 "$launch_output" >&2; fi
exit 1
