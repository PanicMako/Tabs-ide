#!/usr/bin/env bash
# Finder layout is written directly, so release builds need no GUI session.
set -euo pipefail
if [[ $# -ne 3 || ! -d "$1" || "$3" == */* ]]; then
  echo "Usage: $0 staging-directory output.dmg product-name" >&2
  exit 2
fi
script_dir="$(cd "$(dirname "$0")" && pwd)"
resource_dir="$script_dir/../apps/desktop/resources/dmg"
work_dir="$(mktemp -d -t tabs-dmg-layout)"
trap 'rm -rf "$work_dir"' EXIT
# A multi-resolution TIFF keeps the Finder background sharp on Retina displays.
tiffutil -cathidpicheck "$resource_dir/background.png" "$resource_dir/background@2x.png" -out "$work_dir/background.tiff"
if command -v uv >/dev/null 2>&1; then
  uv run --no-project --with dmgbuild==1.6.7 python "$script_dir/lib/dmg-layout.py" "$1/$3.app" "$2" "$3" "$work_dir/background.tiff"
else
  python3 -m venv "$work_dir/venv"
  "$work_dir/venv/bin/python" -m pip install --disable-pip-version-check --quiet dmgbuild==1.6.7
  "$work_dir/venv/bin/python" "$script_dir/lib/dmg-layout.py" "$1/$3.app" "$2" "$3" "$work_dir/background.tiff"
fi
