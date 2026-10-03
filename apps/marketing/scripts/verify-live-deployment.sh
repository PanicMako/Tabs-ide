#!/usr/bin/env bash
set -euo pipefail

site_url="${TABS_MARKETING_URL:-https://buildwithtabs.com}"
dist_dir="$(cd "$(dirname "$0")/.." && pwd)/dist"
work_dir="$(mktemp -d)"
trap 'rm -r "$work_dir"' EXIT

pages=(
  'index.html|/'
  'changelog/index.html|/changelog'
  'downloads/index.html|/downloads'
  'releases.json|/releases.json'
  'community/index.html|/community'
  'feedback/index.html|/feedback'
)

for attempt in {1..20}; do
  matched=true
  for page in "${pages[@]}"; do
    IFS='|' read -r file route <<< "$page"
    if ! curl --fail --silent --show-error --location --max-time 15 \
      "$site_url$route" --output "$work_dir/live" || \
      ! cmp --silent "$dist_dir/$file" "$work_dir/live"; then
      matched=false
      echo "Attempt $attempt: production does not yet match $file"
      break
    fi
  done

  if [ "$matched" = true ]; then
    echo "Production matches all six built marketing files at $site_url"
    exit 0
  fi

  if (( attempt < 20 )); then sleep 15; fi
done

echo "::error::Production still differs from the built marketing site. Check Vercel deployment credentials or the Git deployment."
exit 1
