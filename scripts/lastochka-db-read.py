#!/usr/bin/env python3
"""Open a verified PostgreSQL session using the restricted read-only role."""

import ipaddress
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def main():
    if (len(sys.argv) not in (2, 4) or sys.argv[1] not in ("test", "production")
            or (len(sys.argv) == 4 and (sys.argv[2] not in ("-c", "--command")
                                       or sys.argv[3].lstrip().startswith("\\")))):
        raise SystemExit("Usage: lastochka-db-read {test|production} [-c SQL]")
    zone = sys.argv[1]
    target = json.loads(Path("/run/lastochka-agent/targets.json").read_text())[zone]
    address, identity = target["address"], target["identity"]
    if not ipaddress.ip_address(address).is_private or not re.fullmatch(r"[0-9a-f]{64}", identity):
        raise SystemExit("Invalid database endpoint")
    # Ignore inherited libpq overrides (PGHOSTADDR, PGSERVICE, PGPASSWORD, …)
    # so the identity check and the ensuing session use the same target.
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGPASSFILE"] = f"/home/lastochka-agent/.config/lastochka/{zone}.pgpass"
    environment["PGOPTIONS"] = "-c default_transaction_read_only=on"
    base = ["/usr/bin/psql", "-X", "-w", "-h", address, "-U", "lastochka_reader", "-d", "lastochka"]
    check = subprocess.run(base + ["-qAt", "-c", "SELECT environment || '|' || identifier FROM deploy_guard.identity"],
                           env=environment, capture_output=True, text=True)
    if check.returncode or check.stdout.strip() != f"{zone}|{identity}":
        raise SystemExit("Verified read-only database is unavailable")
    os.execve(base[0], base + sys.argv[2:], environment)


if __name__ == "__main__":
    main()
