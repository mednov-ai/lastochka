#!/usr/bin/env python3
"""Exercise dump and full restore only against a private synthetic fixture."""

import importlib.util
import os
import secrets
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("production_backup", Path(__file__).with_name("backup-production-db.py"))
BACKUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKUP)
BACKUP.DOCKER = shutil.which("docker")


class BackupIntegrationTest(unittest.TestCase):
    def test_dump_and_isolated_restore(self):
        name = "lastochka-backup-fixture-" + secrets.token_hex(8)
        created = False
        try:
            result = subprocess.run([BACKUP.DOCKER, "run", "-d", "--name", name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "-e", "POSTGRES_DB=lastochka", "-e", "POSTGRES_PASSWORD=fixture-only-password", "postgres:17.6-alpine"], capture_output=True)
            self.assertEqual(result.returncode, 0)
            created = True
            for _ in range(60):
                if subprocess.run([BACKUP.DOCKER, "exec", name, "pg_isready", "-U", "postgres", "-d", "lastochka"], capture_output=True).returncode == 0:
                    break
                time.sleep(1)
            else:
                self.fail("Synthetic PostgreSQL did not start")
            seed = subprocess.run([BACKUP.DOCKER, "exec", "-i", name, "psql", "-X", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=b"CREATE TABLE synthetic_fixture (id integer); INSERT INTO synthetic_fixture VALUES (123);", capture_output=True)
            self.assertEqual(seed.returncode, 0)
            image = subprocess.run([BACKUP.DOCKER, "image", "inspect", "postgres:17.6-alpine", "--format", "{{.Id}}"], check=True, capture_output=True, text=True).stdout.strip()
            with tempfile.TemporaryDirectory(prefix="lastochka-backup-test-") as temp:
                work = Path(temp)
                backup = BACKUP.verified_dump(name, image, work)
                self.assertTrue(backup.is_file())
                self.assertGreater(backup.stat().st_size, 0)
                with backup.open("rb") as source:
                    listing = subprocess.run([BACKUP.DOCKER, "exec", "-i", name, "pg_restore", "-l"], stdin=source, capture_output=True)
                self.assertEqual(listing.returncode, 0)
                self.assertIn(b"synthetic_fixture", listing.stdout)
                with self.assertRaises(RuntimeError):
                    BACKUP.verified_dump("nonexistent-fixture-" + secrets.token_hex(6), image, work)
                self.assertEqual(list(work.glob("*.partial")), [backup])
                original_run = subprocess.run

                def fail_restore(args, *positional, **kwargs):
                    if "pg_restore" in args:
                        return subprocess.CompletedProcess(args, 1)
                    return original_run(args, *positional, **kwargs)

                with patch.object(BACKUP.subprocess, "run", side_effect=fail_restore):
                    with self.assertRaises(RuntimeError):
                        BACKUP.verified_dump(name, image, work)
                self.assertEqual(list(work.glob("*.partial")), [backup], "failed restore must remove only its own temporary dump")
                archive = work / "lastochka-production-20261107T120000Z-0123456789abcdef.dump"
                os.link(backup, archive, follow_symlinks=False)
                backup.unlink()
                self.assertEqual(BACKUP.RETENTION.rotate_verified(work, archive.name, 5 * 1024**3), [])
                self.assertTrue(archive.is_file())
                check = subprocess.run([BACKUP.DOCKER, "exec", name, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-c", "SELECT id FROM synthetic_fixture"], capture_output=True, text=True)
                self.assertEqual(check.stdout.strip(), "123")
        finally:
            if created:
                subprocess.run([BACKUP.DOCKER, "rm", "-f", name], capture_output=True, check=True)


if __name__ == "__main__":
    unittest.main()
