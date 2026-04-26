#!/usr/bin/env bash
# Sync themes, schema, and vendor libs from the main resumelang repo
# Run from extension-vscode/ directory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$(cd "$(dirname "$0")" && pwd)"

echo "syncing from $ROOT -> $EXT"

rm -rf "$EXT/themes" "$EXT/schema"
mkdir -p "$EXT/themes" "$EXT/schema" "$EXT/web/vendor"

cp -r "$ROOT/themes/." "$EXT/themes/"
cp "$ROOT/schema/v1.json" "$EXT/schema/v1.json"

cp "$ROOT/web/vendor/handlebars.min.js" "$EXT/web/vendor/handlebars.min.js"
cp "$ROOT/web/vendor/js-yaml.min.js"   "$EXT/web/vendor/js-yaml.min.js"

mkdir -p "$EXT/web/assets"
cp "$ROOT/web/assets/logo.svg"      "$EXT/web/assets/logo.svg"
cp "$ROOT/web/assets/logo-mark.svg" "$EXT/web/assets/logo-mark.svg"

echo "done."
