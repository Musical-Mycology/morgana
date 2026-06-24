#!/usr/bin/env bash
# One build shared by the `next start` and standalone e2e servers.
# Seeds ./data and copies the assets the standalone server needs beside it.
set -euo pipefail
npm run seed:demo
npm run build
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
echo "[prepare-standalone] ready (built once; public + static copied; ./data seeded)"
