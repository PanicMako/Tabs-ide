#!/bin/sh
set -eu

# Hosting secret mounts may be read-only and group-readable. Keep the runtime
# copy private without changing the platform-managed source or image layers.
if [ -n "${EXCHANGE_ONLINE_SIGNING_KEY_FILE:-}" ]; then
  # Render exposes its read-only secret mount through a symbolic link. The
  # destination must resolve to a regular file; validation reads our private copy.
  if [ ! -f "$EXCHANGE_ONLINE_SIGNING_KEY_FILE" ]; then
    echo "Online signing keys require a regular secret file." >&2
    exit 1
  fi
  umask 077
  key_dir="$(mktemp -d "${TMPDIR:-/tmp}/tabs-exchange-keys.XXXXXX")"
  trap 'rm -rf -- "$key_dir"' EXIT
  cp "$EXCHANGE_ONLINE_SIGNING_KEY_FILE" "$key_dir/online-signing.json"
  chmod 600 "$key_dir/online-signing.json"
  export EXCHANGE_ONLINE_SIGNING_KEY_FILE="$key_dir/online-signing.json"
fi

bun run --cwd apps/exchange migrate
exec bun run --cwd apps/exchange start
