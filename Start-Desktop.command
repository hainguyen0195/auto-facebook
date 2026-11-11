#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "Install Node.js 24, then run this launcher again."
  read -r -p "Press Return to close..."
  exit 1
fi
npm run desktop
read -r -p "Press Return to close..."
