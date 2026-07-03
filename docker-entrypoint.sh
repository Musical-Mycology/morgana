#!/bin/sh
set -e

DATA_DIR="${MORGANA_DATA_DIR:-/data}"
DECKS_DIR="$DATA_DIR/decks"
mkdir -p "$DECKS_DIR"

# First-run seed: copy every bundled sample deck ONLY if no deck exists yet.
# Idempotent — never overwrites operator data.
if [ -z "$(ls -A "$DECKS_DIR"/*.deck.json 2>/dev/null)" ]; then
  if [ -d /app/samples ]; then
    for f in /app/samples/*.deck.json; do
      [ -f "$f" ] || continue
      cp "$f" "$DECKS_DIR/"
      echo "[entrypoint] seeded $(basename "$f") into $DECKS_DIR"
    done
  fi
fi

exec "$@"
