#!/usr/bin/env bash
# Build the image, run it with an EMPTY volume, and assert the deck-loading API works
# (auto-seed + dynamic routes + path resolution). The regression guard for the deploy path.
set -euo pipefail

IMAGE="morgana:smoke"
PORT="${SMOKE_PORT:-3009}"
# Optional sub-path to build and probe (e.g. "/morgana"). Empty = root.
BASE="${SMOKE_BASE_PATH:-}"
NAME="morgana-smoke-$$"
# Project-relative scratch volume: /tmp does NOT bind-mount on Docker Desktop/macOS.
DATA="$(mktemp -d "$PWD/.smoke-data.XXXXXX")"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

echo "[smoke] building image…"
docker build --build-arg "MORGANA_BASE_PATH=${BASE}" -t "$IMAGE" .

echo "[smoke] running container with EMPTY volume $DATA (auto-seed must populate it)…"
docker run -d --rm -p "$PORT:3000" -v "$DATA:/data" --name "$NAME" "$IMAGE" >/dev/null

echo "[smoke] waiting for readiness on :${PORT}…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT$BASE/" >/dev/null 2>&1; then break; fi
  if [ "$i" = "30" ]; then echo "[smoke] FAIL: server did not become ready"; docker logs "$NAME" || true; exit 1; fi
  sleep 1
done

echo "[smoke] GET /api/decks must list the auto-seeded demo deck…"
BODY="$(curl -fsS "http://127.0.0.1:$PORT$BASE/api/decks")"
echo "  → $BODY"
case "$BODY" in
  *'"id":"demo"'*) echo "[smoke] OK: /api/decks lists demo" ;;
  *) echo "[smoke] FAIL: /api/decks did not list demo"; exit 1 ;;
esac

echo "[smoke] GET /api/decks/demo must be 200…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE/api/decks/demo")"
[ "$CODE" = "200" ] || { echo "[smoke] FAIL: /api/decks/demo → $CODE"; exit 1; }
echo "[smoke] OK: /api/decks/demo → 200"

echo "[smoke] GET /editor must be 200…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE/editor")"
[ "$CODE" = "200" ] || { echo "[smoke] FAIL: /editor → $CODE"; exit 1; }
echo "[smoke] OK: /editor → 200"

if [ -n "$BASE" ]; then
  echo "[smoke] with a base path set, the bare root must NOT serve the app…"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/decks")"
  [ "$CODE" = "404" ] || { echo "[smoke] FAIL: / served $CODE, expected 404 under base path $BASE"; exit 1; }
  echo "[smoke] OK: bare root → 404"
fi

echo "[smoke] PASS"
