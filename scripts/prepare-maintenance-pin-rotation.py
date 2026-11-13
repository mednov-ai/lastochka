#!/usr/bin/env python3
"""Prepare a replacement PIN using the existing pepper, preserving IP rate limits."""
import argparse
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import stat


def private_file(path):
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o600:
        raise ValueError('Expected a private owner-only file')
    return path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zone', choices=('test', 'production'), required=True)
    parser.add_argument('--secrets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    base = args.secrets
    pepper = private_file(base / f'maintenance-{args.zone}.pepper')
    old_pin = private_file(base / f'maintenance-{args.zone}.pin')
    other_zone = 'production' if args.zone == 'test' else 'test'
    other_pin = private_file(base / f'maintenance-{other_zone}.pin')
    if len(pepper) != 32:
        raise ValueError('Invalid pepper')
    pin = f'{secrets.randbelow(10000):04d}'.encode()
    while pin in (old_pin, other_pin):
        pin = f'{secrets.randbelow(10000):04d}'.encode()
    salt = secrets.token_bytes(16)
    verifier = hashlib.scrypt(hmac.digest(pepper, pin, 'sha256'), salt=salt, n=16384, r=8, p=1, dklen=64)
    args.output.mkdir(mode=0o700)
    for name, value in [('pin', pin), ('hash', f'{salt.hex()}:{verifier.hex()}'.encode())]:
        fd = os.open(args.output / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    print(f'Prepared replacement {args.zone} PIN and verifier in a private directory')


if __name__ == '__main__':
    main()
