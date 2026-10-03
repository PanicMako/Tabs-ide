#!/bin/bash
# Workaround script to create a DMG from the ZIP file
# This avoids the electron-builder DMG creation bug where large files aren't copied

set -e

ZIP_FILE="$1"
if [ -z "$ZIP_FILE" ]; then
    echo "Usage: $0 <path-to-zip-file>"
    exit 1
fi

if [ ! -f "$ZIP_FILE" ]; then
    echo "Error: ZIP file not found: $ZIP_FILE"
    exit 1
fi

# Extract version and arch from filename
BASENAME=$(basename "$ZIP_FILE" .zip)
VERSION=$(echo "$BASENAME" | sed 's/Tabs-\(.*\)-\(.*\)/\1/')
ARCH=$(echo "$BASENAME" | sed 's/Tabs-\(.*\)-\(.*\)/\2/')

echo "Creating DMG for Tabs $VERSION ($ARCH)..."

# Create temporary directory
TMP_DIR=$(mktemp -d)
MOUNT_POINT=""
cleanup() {
    if [ -n "$MOUNT_POINT" ]; then
        hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Extract ZIP
echo "Extracting ZIP..."
unzip -q "$ZIP_FILE" -d "$TMP_DIR"

APP_NAME="${TABS_DESKTOP_PRODUCT_NAME:-Tabs}"
APP_PATH="$TMP_DIR/$APP_NAME.app"
if [ ! -d "$APP_PATH" ]; then
    echo "Error: expected app bundle not found: $APP_PATH"
    exit 1
fi

REQUIRED_FILES=(
    "$APP_PATH/Contents/MacOS/$APP_NAME"
    "$APP_PATH/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
    "$APP_PATH/Contents/Resources/app.asar"
    "$APP_PATH/Contents/Resources/tabs-code-oss/out/vs/code/electron-browser/workbench/workbench-dev.html"
    "$APP_PATH/Contents/Resources/tabs-code-oss/out/vs/base/parts/sandbox/electron-browser/preload.js"
    "$APP_PATH/Contents/Resources/tabs-code-oss/out-build/nls.messages.json"
    "$APP_PATH/Contents/Resources/tabs-code-oss/product.json"
)

for REQUIRED_FILE in "${REQUIRED_FILES[@]}"; do
    if [ ! -e "$REQUIRED_FILE" ]; then
        echo "Error: ZIP payload is missing required file: $REQUIRED_FILE"
        exit 1
    fi
done

# Create DMG
DMG_FILE="${ZIP_FILE%.zip}.dmg"
echo "Creating DMG: $DMG_FILE..."

# Remove old DMG if it exists
rm -f "$DMG_FILE"

# Create DMG using hdiutil (built-in macOS tool)
hdiutil create -volname "$APP_NAME" \
    -srcfolder "$TMP_DIR" \
    -ov -format UDZO \
    "$DMG_FILE"

echo "Validating DMG contents..."
ATTACH_OUTPUT=$(hdiutil attach -readonly -nobrowse -noverify "$DMG_FILE")
MOUNT_POINT=$(printf "%s\n" "$ATTACH_OUTPUT" | awk -F '\t' '/\/Volumes\// { print $NF; exit }')
if [ -z "$MOUNT_POINT" ]; then
    echo "Error: failed to mount generated DMG for validation"
    exit 1
fi

for REQUIRED_FILE in "${REQUIRED_FILES[@]}"; do
    RELATIVE_FILE=${REQUIRED_FILE#"$TMP_DIR/"}
    if [ ! -e "$MOUNT_POINT/$RELATIVE_FILE" ]; then
        echo "Error: generated DMG is missing required file: $RELATIVE_FILE"
        exit 1
    fi
done

echo "DMG created successfully: $DMG_FILE"
ls -lh "$DMG_FILE"
