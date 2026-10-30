#!/usr/bin/env bash
# Builds application artifacts locally, then packages independent target images.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:?Set JAVA_HOME to Java 25}"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] || { echo 'Node.js 24 is required'; exit 1; }
version="${1:-0.1.0}"
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Invalid release version'; exit 1; }
platform="${TARGET_PLATFORM:-linux/amd64}"
output="artifacts/release-$version"
mkdir -p "$output"
backend/gradlew -p backend :app:test :app:bootJar --console=plain
npm --prefix frontend ci --include=dev
npm --prefix frontend run typecheck
npm --prefix frontend run build
# Export/regenerate the contract separately before release; packaging uses saved artifacts.
exec scripts/package-release.sh "$version"
