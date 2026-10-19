#!/usr/bin/env sh
set -eu

cleanup() {
  docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose config --quiet
docker compose up --detach cockpit

attempt=0
until health=$(curl --fail --silent --show-error http://127.0.0.1:8088/healthz); do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker compose logs cockpit >&2
    exit 1
  fi
  sleep 1
done

test "$health" = "ok"
docker compose exec -T cockpit nginx -t
curl --fail --silent --show-error http://127.0.0.1:8088/cockpit/live-control.html | grep -q 'Hermes'
curl --fail --silent --show-error --head http://127.0.0.1:8088/cockpit/assets/hermes-aviator-girl.jpg >/dev/null

echo "PASS: Compose renders, nginx configuration is valid, health is exact, and core static assets are served"
