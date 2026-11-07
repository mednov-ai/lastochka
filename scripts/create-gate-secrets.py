#!/usr/bin/env python3
"""Create a password verifier and session key without passing secrets as arguments."""

import argparse
import hashlib
import os
import secrets
from pathlib import Path


def create_exclusive(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--password-file", type=Path, required=True)
    parser.add_argument("--hash-file", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    if args.hash_file == args.key_file or args.password_file in (args.hash_file, args.key_file):
        raise SystemExit("Secret files must have distinct paths")
    password = args.password_file.read_bytes()
    if not 1 <= len(password) <= 256:
        raise SystemExit("Invalid password file length")
    password.decode("utf-8", errors="strict")
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password, salt=salt, n=16384, r=8, p=1, dklen=64)
    # Never replace existing material: changing a key would invalidate existing sessions.
    if args.hash_file.exists() or args.key_file.exists():
        raise SystemExit("Output already exists; no files were changed")
    created = []
    try:
        create_exclusive(args.hash_file, f"{salt.hex()}:{derived.hex()}".encode("ascii"))
        created.append(args.hash_file)
        create_exclusive(args.key_file, secrets.token_bytes(32))
        created.append(args.key_file)
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    print("Created verifier and session key")


if __name__ == "__main__":
    main()
