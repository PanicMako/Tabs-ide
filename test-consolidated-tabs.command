#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/tabs-app"
export TABS_HOME="$HOME/.tabs-consolidation-test/home"
export TABS_DESKTOP_USER_DATA_DIR="$HOME/.tabs-consolidation-test/profile"
export TABS_CODE_OSS_BUILD_DIR="$(cd ../tabs-code-oss && pwd)"
export NODE_ENV=production
unset ELECTRON_RUN_AS_NODE
unset VITE_DEV_SERVER_URL
exec bun run start:desktop
