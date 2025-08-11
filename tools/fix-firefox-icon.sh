#!/bin/bash
# NOTE: This script is a temporary workaround for https://github.com/PlasmoHQ/plasmo/issues/1307
set -e

# Determine the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$PROJECT_ROOT/assets"
BUILD_DIR="$PROJECT_ROOT/build"

# Find original icon.png
ICON_PATH=$(find "$ASSETS_DIR" -iname "icon.png" | head -n 1)

if [[ -z "$ICON_PATH" ]]; then
  echo "Error: icon.png not found in $ASSETS_DIR"
  exit 1
fi

echo "Found source icon: $ICON_PATH"

# Find Firefox build folder with dynamic tag prefix "firefox-*"
FIREFOX_BUILD_PATH=$(find "$BUILD_DIR" -maxdepth 1 -type d -name "firefox-*" | head -n 1)

if [[ -z "$FIREFOX_BUILD_PATH" ]]; then
  echo "Error: No firefox-* build folder found in $BUILD_DIR"
  exit 1
fi

echo "Firefox build folder: $FIREFOX_BUILD_PATH"

# Find existing icon128*.png in Firefox build folder
ICON128_FILE=$(find "$FIREFOX_BUILD_PATH" -maxdepth 1 -type f -iname "icon128*.png" | head -n 1)

if [[ -z "$ICON128_FILE" ]]; then
  echo "Error: icon128*.png not found in $FIREFOX_BUILD_PATH"
  exit 1
fi

echo "Replacing $ICON128_FILE with original icon.png"

# Replace the icon128*.png with original icon.png
cp "$ICON_PATH" "$ICON128_FILE"

echo "Done. The 128px icon has been replaced with original icon.png."
