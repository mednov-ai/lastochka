#!/usr/bin/env bash
set -euo pipefail
exec 3<>/dev/tcp/127.0.0.1/8080
base="${APP_BASE_PATH-/lastochka}"
base="${base%/}"
printf 'GET %s/actuator/health/readiness HTTP/1.0\r\n\r\n' "$base" >&3
grep -q '"status":"UP"' <&3
