#!/usr/bin/env bash
# The same build-only Kotlin policy runs during checks, bootJar and packaging.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${JAVA_HOME:-}" ]]; then
  backend_java_home="$PWD/runtime-data/toolchains/jdk-25.0.4.1+1/Contents/Home"
  [[ -x "$backend_java_home/bin/java" ]] || { echo 'Set JAVA_HOME to Java 25'; exit 1; }
  export JAVA_HOME="$backend_java_home"
fi
backend/gradlew -p backend architectureCheck --console=plain
