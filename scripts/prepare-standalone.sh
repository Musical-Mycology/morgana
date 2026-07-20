#!/usr/bin/env bash
# One build shared by the `next start` (:3000, :3200) and standalone (:3100) e2e servers.
# Seeds a fresh, isolated data dir per server so specs never contend on shared state,
# then copies the assets the standalone server needs beside it.
set -euo pipefail

# Fresh per-server seeds from the bundled samples (reset each run — no stale decks).
for name in default standalone library; do
  dir=".e2e/$name/decks"
  rm -rf ".e2e/$name"
  mkdir -p "$dir"
  cp samples/*.deck.json "$dir/"
done

npm run build
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
echo "[prepare-standalone] ready (built once; public + static copied; .e2e/{default,standalone,library} seeded)"
