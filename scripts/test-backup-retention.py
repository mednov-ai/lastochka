#!/usr/bin/env python3
import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("backup_retention", Path(__file__).with_name("backup-retention.py"))
RETENTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RETENTION)


class BackupRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lastochka-backup-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.names = [f"lastochka-production-2026110{i}T030000Z-{i:016x}.dump" for i in range(1, 4)]
        for name in self.names:
            (self.root / name).write_bytes(b"synthetic")

    def test_removes_oldest_and_keeps_verified(self):
        removed = RETENTION.rotate_verified(self.root, self.names[-1], 18)
        self.assertEqual(removed, [self.names[0]])
        self.assertTrue((self.root / self.names[-1]).exists())
        self.assertTrue((self.root / self.names[1]).exists())

    def test_oversize_or_unexpected_entries_preserve_everything(self):
        with self.assertRaises(ValueError):
            RETENTION.rotate_verified(self.root, self.names[-1], 1)
        self.assertTrue(all((self.root / name).exists() for name in self.names))
        (self.root / "unrelated.txt").write_text("do not touch")
        with self.assertRaises(ValueError):
            RETENTION.rotate_verified(self.root, self.names[-1], 18)
        self.assertTrue(all((self.root / name).exists() for name in self.names))
        self.assertEqual((self.root / "unrelated.txt").read_text(), "do not touch")

    def test_symlink_and_missing_verified_fail_closed(self):
        (self.root / self.names[0]).unlink()
        (self.root / self.names[0]).symlink_to(self.names[1])
        with self.assertRaises(ValueError):
            RETENTION.rotate_verified(self.root, self.names[-1], 18)
        with self.assertRaises(ValueError):
            RETENTION.rotate_verified(self.root, "missing", 18)
        self.assertTrue((self.root / self.names[1]).exists())
        self.assertTrue((self.root / self.names[-1]).exists())


if __name__ == "__main__":
    unittest.main()
