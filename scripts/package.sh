#!/bin/sh
# Zips the files Chrome needs into dist/ethglobalists-<version>.zip (for the Chrome Web Store or a release).
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/ethglobalists-$version.zip"
rm -f "$out"
zip -qr "$out" manifest.json src icons LICENSE -x "*.DS_Store"
echo "$out"
