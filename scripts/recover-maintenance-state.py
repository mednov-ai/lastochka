#!/usr/bin/env python3
"""Operator-only reset of a dedicated maintenance limiter, not an application DB."""

import argparse
from contextlib import closing
import os
import sqlite3
import stat
from pathlib import Path


def recover(path: Path, zone: str, owner_uid: int) -> None:
    if zone not in ("test", "production"):
        raise ValueError("Invalid environment")
    parent, info = path.parent.lstat(), path.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != owner_uid or stat.S_IMODE(parent.st_mode) != 0o700
            or not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or stat.S_IMODE(info.st_mode) != 0o600):
        raise ValueError("Unprotected state path")
    # Open existing state only; a missing or mismatched file must never be created.
    uri = path.as_uri() + "?mode=rw"
    with closing(sqlite3.connect(uri, uri=True, timeout=3, isolation_level=None)) as db:
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("BEGIN IMMEDIATE")
        try:
            if (db.execute("PRAGMA quick_check").fetchone()[0] != "ok"
                    or db.execute("PRAGMA user_version").fetchone()[0] != 1
                    or db.execute("SELECT zone FROM maintenance_meta").fetchall() != [(zone,)]):
                raise ValueError("State identity or integrity mismatch")
            db.execute("DELETE FROM failures")
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zone", choices=("test", "production"), required=True)
    parser.add_argument("--confirm-reset", choices=("test", "production"), required=True)
    args = parser.parse_args()
    if os.geteuid() != 0 or args.confirm_reset != args.zone:
        raise SystemExit("Root operator and matching explicit zone confirmation required")
    recover(Path(f"/var/lib/lastochka/maintenance/{args.zone}/rate.sqlite"), args.zone, 10001)
    print(f"Maintenance limiter reset by operator for {args.zone}; no application data changed")


if __name__ == "__main__":
    main()
