#!/usr/bin/env bash
# Read-only; does not install, reload, restart or alter the shared server.
set -euo pipefail
host="${1:-repairdevice-selectel}"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" 'bash -s' <<'REMOTE'
set -euo pipefail
uname -m
getconf _NPROCESSORS_ONLN
free -m
df -m /
nginx -t
sha256sum /etc/nginx/sites-available/play-and-say
if command -v docker >/dev/null; then docker version --format '{{.Server.Version}}'; docker compose version; else echo 'Docker is not installed'; fi
ss -lnt '( sport = :18080 or sport = :18026 )'
for path in / /repair_demo/; do curl --fail --silent --output /dev/null --write-out "$path %{http_code}\n" "https://play-and-say.ru$path"; done
REMOTE
