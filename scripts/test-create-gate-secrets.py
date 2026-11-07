#!/usr/bin/env python3
import hashlib
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("create-gate-secrets.py")


class GateSecretTest(unittest.TestCase):
    def test_creation_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            password = root / "password"
            password.write_text("  synthetic password 123  ", encoding="utf-8")
            verifier, key = root / "hash", root / "key"
            command = ["python3", str(SCRIPT), "--password-file", str(password), "--hash-file", str(verifier), "--key-file", str(key)]
            subprocess.run(command, check=True, capture_output=True)
            salt, expected = verifier.read_text().split(":")
            actual = hashlib.scrypt(password.read_bytes(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=64)
            self.assertEqual(actual.hex(), expected)
            self.assertEqual(len(key.read_bytes()), 32)
            self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
            old_key, old_verifier = key.read_bytes(), verifier.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(key.read_bytes(), old_key)
            self.assertEqual(verifier.read_bytes(), old_verifier)

    def test_existing_key_does_not_create_verifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "password").write_text("synthetic")
            (root / "key").write_bytes(os.urandom(32))
            result = subprocess.run(["python3", str(SCRIPT), "--password-file", str(root / "password"), "--hash-file", str(root / "hash"), "--key-file", str(root / "key")], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / "hash").exists())


if __name__ == "__main__":
    unittest.main()
