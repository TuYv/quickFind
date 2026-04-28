#!/usr/bin/env bash
# 打包 Chrome 扩展为 pounce-<version>.zip
# 用法：./build.sh        → 读 manifest.json 的 version
#       ./build.sh 1.5.0  → 覆盖版本号

set -euo pipefail

cd "$(dirname "$0")"

FILES=(
  manifest.json
  background.js
  popup.html
  popup.js
  options.html
  options.js
  options-theme-sync.js
  theme-manager.js
  preferences.js
  search-overlay.js
  search-overlay.css
  search-ranking.js
  bridge.html
  icons
)

for f in "${FILES[@]}"; do
  if [[ ! -e "$f" ]]; then
    echo "error: missing $f" >&2
    exit 1
  fi
done

if [[ $# -ge 1 ]]; then
  VERSION="$1"
else
  VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
fi

OUT="pounce-${VERSION}.zip"

if [[ -e "$OUT" ]]; then
  echo "error: $OUT already exists, remove it or pass a new version" >&2
  exit 1
fi

zip -r -q "$OUT" "${FILES[@]}" -x '**/.DS_Store'

echo "built $OUT"
unzip -l "$OUT" | tail -1
