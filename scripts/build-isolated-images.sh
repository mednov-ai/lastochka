#!/usr/bin/env bash
set -euo pipefail

# Build the release images outside the VPS from already-built frontend and JAR.
# Run from a clean, reviewed source checkout after the project build and tests.
if [[ $# -ne 1 || "$1" != /* || "$1" == *,* || ! -d "$1" ]]; then
  echo "Usage: $0 /absolute/existing/empty-output-directory" >&2
  exit 2
fi
out="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
for image in backend frontend gate; do
  if [[ -e "$out/$image.tar" ]]; then
    echo "Refusing to overwrite $out/$image.tar" >&2
    exit 1
  fi
done
test -f "$root/backend/app/build/libs/app-0.1.0.jar"
test -d "$root/frontend/build/client"
cd "$root"
common=(--no-cache --platform linux/amd64 --provenance=false --build-arg SOURCE_DATE_EPOCH=0)
docker buildx build "${common[@]}" --build-arg APP_VERSION=isolated-v1 \
  --output "type=docker,dest=$out/backend.tar,rewrite-timestamp=true" \
  -f infra/backend/Dockerfile -t lastochka-backend:epoch-v1 .
docker buildx build "${common[@]}" --build-arg APP_VERSION=0.19.1 \
  --output "type=docker,dest=$out/frontend.tar,rewrite-timestamp=true" \
  -f infra/frontend/Dockerfile -t lastochka-frontend:epoch-v1 .
docker buildx build "${common[@]}" \
  --output "type=docker,dest=$out/gate.tar,rewrite-timestamp=true" \
  -f infra/site-gate/Dockerfile -t lastochka-site-gate:epoch-a .
shasum -a 256 "$out/backend.tar" "$out/frontend.tar" "$out/gate.tar"
