#!/usr/bin/env python3
import importlib.util
import stat
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("secrets_factory", Path(__file__).with_name("create-maintenance-secrets.py"))
FACTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FACTORY)


class SecretTests(unittest.TestCase):
    def test_generation_is_private_distinct_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            FACTORY.create(directory, "test")
            FACTORY.create(directory, "production")
            a = (directory / "maintenance-test.pin").read_bytes()
            b = (directory / "maintenance-production.pin").read_bytes()
            self.assertRegex(a, rb"^[0-9]{4}$")
            self.assertNotEqual(a, b)
            self.assertTrue(all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in directory.iterdir()))
            with self.assertRaises(FileExistsError):
                FACTORY.create(directory, "test")
            self.assertEqual((directory / "maintenance-test.pin").read_bytes(), a)

    def test_leading_zero_and_format_are_preserved(self):
        pepper, salt = bytes(32), bytes(16)
        self.assertEqual(FACTORY.derive(b"0007", pepper, salt), FACTORY.derive(b"0007", pepper, salt))
        self.assertNotEqual(FACTORY.derive(b"0007", pepper, salt), FACTORY.derive(b"0008", pepper, salt))
        for value in (b"007", b"00007", b"-007", "０００７".encode()):
            with self.assertRaises(ValueError):
                FACTORY.derive(value, pepper, salt)


if __name__ == "__main__":
    unittest.main()
