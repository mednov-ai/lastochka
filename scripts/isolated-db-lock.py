#!/usr/bin/env python3
"""Shared root-only lock for protected backup and migration operations."""

import fcntl
import os
import stat
from contextlib import contextmanager


@contextmanager
def exclusive_lock(zone: str):
    if zone not in ("production", "test"):
        raise ValueError("Invalid zone")
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(f"/run/lock/lastochka-{zone}-db.lock", flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Operation lock is not protected")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)
