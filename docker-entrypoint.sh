#!/bin/sh
set -e

DATA_DIR="${MORGANA_DATA_DIR:-/data}"
DECKS_DIR="$DATA_DIR/decks"
mkdir -p "$DECKS_DIR"

# First-run seed: copy the bundled demo deck ONLY if no deck exists yet.
# Idempotent — never overwrites operator data.
if [ -z "$(ls -A "$DECKS_DIR"/*.deck.json 2>/dev/null)" ]; then
  if [ -f /app/samples/demo.deck.json ]; then
    cp /app/samples/demo.deck.json "$DECKS_DIR/demo.deck.json"
    echo "[entrypoint] seeded demo deck into $DECKS_DIR"
  fi
fi

exec "$@"
