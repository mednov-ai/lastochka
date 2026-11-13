#!/usr/bin/env python3
"""Initialize only a new, dedicated PIN rate-state file, never an app database."""

import argparse
from contextlib import closing
import os
import sqlite3
import stat
from pathlib import Path


def initialize(path: Path, zone: str) -> None:
    if zone not in ("test", "production"):
        raise ValueError("Invalid environment")
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or stat.S_IMODE(parent.st_mode) != 0o700:
        raise ValueError("State directory must be private and owned by operator")
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    try:
        with closing(sqlite3.connect(path)) as db:
            db.executescript("""
                PRAGMA journal_mode=DELETE;
                PRAGMA synchronous=FULL;
                PRAGMA user_version=1;
                CREATE TABLE maintenance_meta (zone TEXT NOT NULL UNIQUE);
                CREATE TABLE failures (occurred INTEGER NOT NULL, client TEXT NOT NULL);
                CREATE INDEX failures_occurred ON failures (occurred);
            """)
            db.execute("INSERT INTO maintenance_meta(zone) VALUES (?)", (zone,))
            db.commit()
        if stat.S_IMODE(path.stat().st_mode) != 0o600:
            raise ValueError("Unsafe state file permissions")
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--zone", required=True, choices=("test", "production"))
    args = parser.parse_args()
    initialize(args.path, args.zone)
    print("Initialized dedicated maintenance rate state")


if __name__ == "__main__":
    main()
