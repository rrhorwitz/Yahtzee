#!/usr/bin/env bash
# Copies the web app into www/ for the native (Capacitor) build.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www
mkdir -p www/icons
cp index.html styles.css scoring.js fx.js app.js native.js manifest.webmanifest www/
cp icons/*.png icons/*.svg www/icons/
mkdir -p www/vendor && cp vendor/dice3d.js www/vendor/
mkdir -p www/sounds && cp sounds/*.m4a www/sounds/
echo "Built www/"
