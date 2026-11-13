#!/usr/bin/env python3
"""Create independent PIN credentials without exposing PINs in arguments or output."""

import argparse
import hashlib
import hmac
import os
import re
import secrets
import stat
from pathlib import Path


def derive(pin: bytes, pepper: bytes, salt: bytes) -> bytes:
    if not re.fullmatch(rb"[0-9]{4}", pin) or len(pepper) != 32 or len(salt) != 16:
        raise ValueError("Invalid PIN verifier input")
    return hashlib.scrypt(hmac.digest(pepper, pin, "sha256"), salt=salt, n=16384, r=8, p=1, dklen=64)


def write_new(path: Path, value: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())


def create(directory: Path, zone: str) -> None:
    if zone not in ("test", "production"):
        raise ValueError("Invalid zone")
    directory_info = directory.lstat()
    if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != os.geteuid() or directory_info.st_mode & 0o077:
        raise ValueError("Secret directory must be private and owned by the current user")
    paths = {kind: directory / f"maintenance-{zone}.{kind}" for kind in ("pin", "hash", "pepper", "session-key")}
    if any(path.exists() or path.is_symlink() for path in paths.values()):
        raise FileExistsError("Secret material already exists")
    other = directory / f"maintenance-{'production' if zone == 'test' else 'test'}.pin"
    existing = None
    if other.exists() or other.is_symlink():
        info = other.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Other environment PIN must be a private regular file")
        existing = other.read_bytes()
        if not re.fullmatch(rb"[0-9]{4}", existing):
            raise ValueError("Other environment PIN is invalid")
    pin = f"{secrets.randbelow(10000):04d}".encode("ascii")
    while pin == existing:
        pin = f"{secrets.randbelow(10000):04d}".encode("ascii")
    pepper, salt = secrets.token_bytes(32), secrets.token_bytes(16)
    verifier = f"{salt.hex()}:{derive(pin, pepper, salt).hex()}".encode("ascii")
    values = {"pin": pin, "hash": verifier, "pepper": pepper, "session-key": secrets.token_bytes(32)}
    made = []
    try:
        for kind, path in paths.items():
            write_new(path, values[kind])
            made.append(path)
    except BaseException:
        for path in made:
            path.unlink(missing_ok=True)
        raise
    print(f"Created independent {zone} PIN verifier and protected keys")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--zone", required=True, choices=("test", "production"))
    args = parser.parse_args()
    create(args.directory, args.zone)


if __name__ == "__main__":
    main()
