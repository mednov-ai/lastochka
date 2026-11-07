#!/usr/bin/env python3
"""Publish verified database endpoints to the restricted SSH account."""

import importlib.util
import ipaddress
import json
import os
import stat
import subprocess
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("isolated_db", Path(__file__).with_name("provision-isolated-db.py"))
DB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DB)
DIRECTORY = Path("/run/lastochka-agent")


def command(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def main():
    if os.geteuid() != 0:
        raise SystemExit("Endpoint refresh requires the separately controlled root operator")
    DIRECTORY.mkdir(mode=0o755, exist_ok=True)
    info = DIRECTORY.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o755:
        raise SystemExit("Unprotected endpoint directory")
    targets = {}
    for zone in ("test", "production"):
        container, identity = DB.verify_target(zone)
        marker = command(["/usr/bin/docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"],
                         input="SELECT environment || '|' || identifier FROM deploy_guard.identity;")
        if marker != f"{zone}|{identity}":
            raise SystemExit("Database marker mismatch")
        inspected = json.loads(command(["/usr/bin/docker", "container", "inspect", container]))[0]
        address = inspected["NetworkSettings"]["Networks"][f"lastochka-{zone}_default"]["IPAddress"]
        if not ipaddress.ip_address(address).is_private:
            raise SystemExit("Database endpoint is not private")
        targets[zone] = {"address": address, "identity": identity}
    temporary = DIRECTORY / f".targets-{os.getpid()}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(targets, output); output.write("\n"); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, DIRECTORY / "targets.json")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
