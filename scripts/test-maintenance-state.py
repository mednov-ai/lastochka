#!/usr/bin/env python3
import importlib.util
from contextlib import closing
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


INIT = load("maintenance_init", "init-maintenance-state.py")
RECOVER = load("maintenance_recover", "recover-maintenance-state.py")


class StateTests(unittest.TestCase):
    def test_explicit_recovery_is_scoped_and_does_not_reinitialize(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "rate.sqlite"
            INIT.initialize(path, "test")
            with closing(sqlite3.connect(path)) as db:
                db.execute("INSERT INTO failures VALUES(?, ?)", (100, "synthetic-ip"))
                db.commit()
            with self.assertRaises(ValueError):
                RECOVER.recover(path, "production", os.geteuid())
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM failures").fetchone()[0], 1)
            RECOVER.recover(path, "test", os.geteuid())
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM failures").fetchone()[0], 0)
            with self.assertRaises(FileExistsError):
                INIT.initialize(path, "test")


if __name__ == "__main__":
    unittest.main()
