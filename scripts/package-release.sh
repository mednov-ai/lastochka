#!/usr/bin/env bash
# Package already verified local JAR and frontend builds; no compilation occurs here.
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/check-backend-architecture.sh
npm --prefix frontend run check:ui-language
version="${1:-0.1.0}"
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Invalid release version'; exit 1; }
platform="${TARGET_PLATFORM:-linux/amd64}"
output="artifacts/release-$version"
test -f backend/app/build/libs/app-0.1.0.jar
test -f frontend/build/server/index.js
mkdir -p "$output"
docker build --platform "$platform" --build-arg "JRE_IMAGE=${JRE_IMAGE:-eclipse-temurin:25-jre}" --build-arg "APP_VERSION=$version" -f infra/backend/Dockerfile -t "lastochka-backend:$version" .
if [[ -n "${FRONTEND_RUNTIME_IMAGE:-}" ]]; then
  docker build --platform "$platform" --build-arg "RUNTIME_IMAGE=$FRONTEND_RUNTIME_IMAGE" --build-arg "APP_VERSION=$version" -f infra/frontend/Dockerfile.runtime -t "lastochka-frontend:$version" .
else
  docker build --platform "$platform" --build-arg "NODE_IMAGE=${NODE_IMAGE:-node:24-alpine}" --build-arg "APP_VERSION=$version" -f infra/frontend/Dockerfile -t "lastochka-frontend:$version" .
fi
python3 scripts/check-concept-release.py "lastochka-backend:$version" "lastochka-frontend:$version"
docker image inspect "lastochka-backend:$version" "lastochka-frontend:$version" --format '{{json .}}' > "$output/images.jsonl"
docker save "lastochka-backend:$version" "lastochka-frontend:$version" | gzip > "$output/application-images.tar.gz"
cp compose.preview.yaml .env.preview.example "$output/"
cp docs/enquiry-notification-operations.md "$output/DELIVERY.md"
cp scripts/configure-browser-push.py "$output/configure-browser-push.py"
cp scripts/check-concept-release.py "$output/check-concept-release.py"
mkdir -p "$output/infra"
cp infra/preview-proxy.conf infra/shared-server-lastochka.conf "$output/infra/"
python3 - "$output" "$version" <<'PY'
import hashlib, json, pathlib, sys
root=pathlib.Path(sys.argv[1]); docs=[]
(root/'compatibility.json').write_text(json.dumps({'schema':18,'enquiryNotifications':'ENQUIRY_MULTICHANNEL_V1','concept':'ADMIN_ENQUIRIES_V1','passwordLifecycle':'PASSWORD_LIFECYCLE_V1','recurringGroups':'RECURRING_GROUPS_V1','inlineRecurrence':'INLINE_RECURRENCE_V1','sessionCorrections':'SESSION_CORRECTIONS_V1'},indent=2)+'\n')
example=root/'.env.preview.example'
value=example.read_text().replace('BACKEND_IMAGE=lastochka-backend:0.1.0','BACKEND_IMAGE=lastochka-backend:'+sys.argv[2]).replace('FRONTEND_IMAGE=lastochka-frontend:0.1.0','FRONTEND_IMAGE=lastochka-frontend:'+sys.argv[2])
example.write_text(value)
for path in sorted(root.rglob("*")):
    if path.is_file() and path.name != "manifest.json":
        h=hashlib.sha256()
        with path.open('rb') as file:
            for chunk in iter(lambda:file.read(1024*1024),b''):h.update(chunk)
        docs.append({'file':str(path.relative_to(root)),'sha256':h.hexdigest(),'bytes':path.stat().st_size})
(root/'manifest.json').write_text(json.dumps(docs,indent=2)+'\n')
PY
echo "Release artifacts: $output"
