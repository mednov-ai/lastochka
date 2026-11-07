#!/usr/bin/env python3
"""Create and restore-check a production backup before rotating older copies."""

import datetime
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


DB = module("isolated_db", "provision-isolated-db.py")
LOCK = module("isolated_db_lock", "isolated-db-lock.py")
RETENTION = module("backup_retention", "backup-retention.py")
DOCKER = "/usr/bin/docker"
BACKUPS = Path("/opt/lastochka/backups/production")
# The verified temporary file shares the destination directory: systemd's
# per-path bind mounts otherwise make cross-directory hard links fail with EXDEV.
WORK = BACKUPS
KEY_SOURCE = Path("/etc/lastochka/production/alfa-keys")
KEY_BACKUPS = Path("/opt/lastochka/key-backups/production")
LIMIT = 5 * 1024**3


def command(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        raise RuntimeError("Backup operation failed; existing archives were preserved")
    return result.stdout


def secure_directory(path: Path, mode: int = 0o700) -> None:
    for item in (path, *path.parents):
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("Backup path must have protected root-owned directories")
    if stat.S_IMODE(path.stat().st_mode) != mode:
        raise ValueError("Backup directory has unsafe permissions")


def preserve_keys(source: Path, destination: Path) -> None:
    """Never overwrite a key ID or delete old key copies."""
    directory_info = source.lstat()
    if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_uid != 10001 or stat.S_IMODE(directory_info.st_mode) != 0o700:
        raise ValueError("Encryption key directory is not protected")
    entries = sorted(source.iterdir())
    if not entries:
        raise ValueError("No encryption keys available for recovery")
    for item in entries:
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.key", item.name):
            raise ValueError("Unexpected encryption key file")
        info = item.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 10001 or not 1 <= info.st_size <= 4096 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Encryption key source is not protected")
        descriptor = os.open(item, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as input_file:
            opened = os.fstat(input_file.fileno())
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise ValueError("Encryption key changed during backup")
            data = input_file.read(4097)
        if not 1 <= len(data) <= 4096:
            raise ValueError("Invalid encryption key length")
        target = destination / item.name
        if target.exists() or target.is_symlink():
            target_info = target.lstat()
            if not stat.S_ISREG(target_info.st_mode) or target_info.st_uid != 0 or stat.S_IMODE(target_info.st_mode) != 0o600 or target.read_bytes() != data:
                raise ValueError("Existing key backup differs; refusing overwrite")
            continue
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(target, flags, 0o600)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
        except BaseException:
            target.unlink(missing_ok=True)
            raise


def inspect(kind: str, name: str) -> dict:
    return json.loads(command([DOCKER, kind, "inspect", name]))[0]


def check_identity(container: str, identity: str) -> None:
    sql = "SELECT environment || '|' || identifier FROM deploy_guard.identity;"
    output = command([DOCKER, "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql.encode())
    if output.decode().strip() != f"production|{identity}":
        raise ValueError("Database identity does not match production")


def check_space(container: str, directory: Path) -> None:
    sql = "SELECT pg_database_size(current_database());"
    output = command([DOCKER, "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql.encode())
    size = int(output.decode().strip())
    stats = os.statvfs(directory)
    free = stats.f_bavail * stats.f_frsize
    if free < 2 * size + 256 * 1024**2:
        raise RuntimeError("Insufficient space for dump and isolated restore")


def verified_dump(container: str, image_id: str, work: Path) -> Path:
    """Dump and fully restore into a private, labelled, disposable database."""
    nonce = secrets.token_hex(16)
    volume = f"lastochka-restore-check-{nonce}"
    restore_container = f"lastochka-restore-check-{nonce}"
    partial = work / f"{nonce}.partial"
    volume_created = False
    container_created = False
    try:
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "wb") as output:
            result = subprocess.run([DOCKER, "exec", container, "pg_dump", "-U", "postgres", "-d", "lastochka", "--format=custom", "--compress=9", "--no-owner", "--no-acl"], stdout=output, stderr=subprocess.DEVNULL)
            output.flush()
            os.fsync(output.fileno())
        if result.returncode or partial.stat().st_size == 0:
            raise RuntimeError("Database dump failed")
        if subprocess.run([DOCKER, "volume", "inspect", volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise RuntimeError("Temporary volume collision")
        command([DOCKER, "volume", "create", "--label", "org.lastochka.purpose=backup-restore-test", "--label", f"org.lastochka.nonce={nonce}", volume])
        labels = inspect("volume", volume).get("Labels") or {}
        if labels.get("org.lastochka.purpose") != "backup-restore-test" or labels.get("org.lastochka.nonce") != nonce:
            raise RuntimeError("Temporary volume identity mismatch")
        volume_created = True
        container_created = True
        command([DOCKER, "run", "-d", "--name", restore_container, "--network", "none", "--memory", "256m", "--cpus", "0.35", "--label", "org.lastochka.purpose=backup-restore-test", "--label", f"org.lastochka.nonce={nonce}", "-v", f"{volume}:/var/lib/postgresql/data", "-e", "POSTGRES_DB=restorecheck", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image_id])
        for _ in range(120):
            # The PostgreSQL image starts a temporary socket-only server during
            # initialization. TCP becomes ready only for the final server.
            if subprocess.run([DOCKER, "exec", restore_container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "restorecheck"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Isolated restore database did not start")
        with partial.open("rb") as source:
            result = subprocess.run([DOCKER, "exec", "-i", restore_container, "pg_restore", "-h", "127.0.0.1", "-U", "postgres", "-d", "restorecheck", "--exit-on-error", "--no-owner", "--no-acl"], stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if result.returncode:
            # Do not log pg_restore output: it may contain sensitive row values.
            error = (result.stderr or b"").lower()
            category = "connection" if any(term in error for term in (b"connection", b"server closed", b"terminating")) else "restore"
            raise RuntimeError(f"Full isolated restore failed ({category}; exit {result.returncode})")
        return partial
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    finally:
        cleanup_failed = False
        if container_created:
            try:
                found = subprocess.run([DOCKER, "container", "inspect", restore_container], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if found.returncode == 0:
                    info = json.loads(found.stdout)[0]
                    labels = info.get("Config", {}).get("Labels") or {}
                    mounts = [m for m in info.get("Mounts", []) if m.get("Destination") == "/var/lib/postgresql/data"]
                    if labels.get("org.lastochka.purpose") != "backup-restore-test" or labels.get("org.lastochka.nonce") != nonce or len(mounts) != 1 or mounts[0].get("Name") != volume:
                        raise RuntimeError("Temporary container identity mismatch")
                    command([DOCKER, "rm", "-f", restore_container])
            except Exception:
                cleanup_failed = True
        if volume_created:
            try:
                labels = inspect("volume", volume).get("Labels") or {}
                users = command([DOCKER, "ps", "-aq", "--filter", f"volume={volume}"]).strip()
                if labels.get("org.lastochka.purpose") == "backup-restore-test" and labels.get("org.lastochka.nonce") == nonce and not users:
                    command([DOCKER, "volume", "rm", volume])
                else:
                    cleanup_failed = True
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            partial.unlink(missing_ok=True)
            raise RuntimeError("Isolated restore cleanup failed; no backup rotation was performed")


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Backup requires the separately controlled root operator")
    os.umask(0o077)
    with LOCK.exclusive_lock("production"):
        for directory in (BACKUPS, WORK, KEY_BACKUPS, KEY_SOURCE.parent):
            secure_directory(directory)
        if BACKUPS.stat().st_dev != WORK.stat().st_dev:
            raise SystemExit("Backup and work directories must share a filesystem")
        container, identity = DB.verify_target("production")
        manifest = json.loads(Path("/etc/lastochka/production/target.json").read_text())
        image_id = manifest["postgres_image_id"]
        check_identity(container, identity)
        check_space(container, WORK)
        preserve_keys(KEY_SOURCE, KEY_BACKUPS)
        temporary = verified_dump(container, image_id, WORK)
        try:
            DB.verify_target("production")
            check_identity(container, identity)
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            name = f"lastochka-production-{stamp}-{secrets.token_hex(8)}.dump"
            destination = BACKUPS / name
            if destination.exists() or destination.is_symlink():
                raise RuntimeError("Backup archive collision")
            os.link(temporary, destination, follow_symlinks=False)
            temporary.unlink()
            directory_fd = os.open(BACKUPS, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            RETENTION.rotate_verified(BACKUPS, name, LIMIT)
            print("Compressed production backup restored successfully and retention applied")
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
