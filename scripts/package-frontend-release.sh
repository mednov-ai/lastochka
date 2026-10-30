#!/usr/bin/env bash
# Package an already verified frontend build without rebuilding or restarting backend.
set -euo pipefail
cd "$(dirname "$0")/.."
npm --prefix frontend run check:ui-language
version="${1:?Provide an immutable frontend version}"
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Invalid release version'; exit 1; }
output="artifacts/frontend-release-$version"
test -f frontend/build/server/index.js
mkdir -p "$output/infra"
if [[ -n "${FRONTEND_RUNTIME_IMAGE:-}" ]]; then
  docker build --platform "${TARGET_PLATFORM:-linux/amd64}" \
    --build-arg "RUNTIME_IMAGE=$FRONTEND_RUNTIME_IMAGE" --build-arg "APP_VERSION=$version" \
    -f infra/frontend/Dockerfile.runtime -t "lastochka-frontend:$version" .
else
  docker build --platform "${TARGET_PLATFORM:-linux/amd64}" \
    --build-arg "NODE_IMAGE=${NODE_IMAGE:-node:24-alpine}" \
    --build-arg "APP_VERSION=$version" \
    -f infra/frontend/Dockerfile -t "lastochka-frontend:$version" .
fi
docker image inspect "lastochka-frontend:$version" > "$output/images.json"
docker save "lastochka-frontend:$version" | gzip > "$output/frontend-image.tar.gz"
cp compose.preview.yaml "$output/"
cp infra/preview-proxy.conf "$output/infra/"
python3 - "$output" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); entries=[]
(root/'compatibility.json').write_text(json.dumps({'schema':18,'requiredEnquiryCapability':'ENQUIRY_MULTICHANNEL_V1','requiredBackendCapability':'PASSWORD_LIFECYCLE_V1','requiredScheduleCapability':'RECURRING_GROUPS_V1'},indent=2)+'\n')
for path in sorted(root.rglob('*')):
    if path.is_file() and path.name != 'manifest.json':
        h=hashlib.sha256()
        with path.open('rb') as file:
            for chunk in iter(lambda:file.read(1024*1024),b''):h.update(chunk)
        entries.append({'file':str(path.relative_to(root)), 'sha256':h.hexdigest(), 'bytes':path.stat().st_size})
(root/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n')
PY
echo "Frontend release artifacts: $output"
