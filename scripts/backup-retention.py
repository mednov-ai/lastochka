#!/usr/bin/env python3
"""Rotate only owned production archives after a newly restored backup has passed."""

import os
import re
import stat
from pathlib import Path

ARCHIVE = re.compile(r"lastochka-production-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}\.dump")


def rotate_verified(directory: Path, verified_name: str, limit_bytes: int) -> list[str]:
    """Caller must hold the backup lock and have actually restored verified_name."""
    if not ARCHIVE.fullmatch(verified_name) or limit_bytes <= 0:
        raise ValueError("Invalid verified backup or limit")
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("Backup destination must be a real directory")
    flags = os.O_RDONLY | os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(directory, flags)
    try:
        archives = {}
        for name in os.listdir(descriptor):
            if name == ".backup.lock":
                continue
            if not ARCHIVE.fullmatch(name):
                raise ValueError("Unexpected entry in backup directory; no rotation performed")
            entry = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if not stat.S_ISREG(entry.st_mode):
                raise ValueError("Backup entry is not a regular file")
            archives[name] = entry
        if verified_name not in archives or archives[verified_name].st_size == 0:
            raise ValueError("Verified backup is absent or empty")
        total = sum(item.st_size for item in archives.values())
        remove = []
        for name in sorted(archives):
            if total <= limit_bytes:
                break
            if name == verified_name:
                continue
            remove.append(name)
            total -= archives[name].st_size
        if total > limit_bytes:
            raise ValueError("The verified backup cannot fit; no rotation performed")
        for name in remove:
            current = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            original = archives[name]
            if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino, current.st_size) != (original.st_dev, original.st_ino, original.st_size):
                raise ValueError("Backup changed during rotation")
            os.unlink(name, dir_fd=descriptor)
        os.fsync(descriptor)
        return remove
    finally:
        os.close(descriptor)
