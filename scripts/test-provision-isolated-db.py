#!/usr/bin/env python3
"""Run role tests only in an isolated disposable PostgreSQL container."""

import importlib.util
import copy
import hashlib
import secrets
import subprocess
import time
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("isolated_db", Path(__file__).with_name("provision-isolated-db.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RoleProvisioningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.name = "lastochka-role-fixture-" + secrets.token_hex(8)
        result = subprocess.run(["docker", "run", "-d", "--name", cls.name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "-e", "POSTGRES_DB=lastochka", "-e", "POSTGRES_PASSWORD=fixture-admin-password", "postgres:17.6-alpine"], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Could not create isolated fixture container")
        for _ in range(60):
            if subprocess.run(["docker", "exec", cls.name, "pg_isready", "-U", "postgres", "-d", "lastochka"], capture_output=True).returncode == 0:
                break
            time.sleep(1)
        else:
            subprocess.run(["docker", "rm", "-f", cls.name], capture_output=True)
            raise RuntimeError("Fixture database did not become ready")

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["docker", "rm", "-f", cls.name], check=True, capture_output=True)

    def psql(self, sql):
        return subprocess.run(["docker", "exec", "-i", self.name, "psql", "-X", "-q", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, capture_output=True)

    def test_roles_and_repeat_fail_closed(self):
        passwords = {role: f"synthetic-{index}-password".encode() for index, role in enumerate(MODULE.ROLES)}
        sql = MODULE.build_sql("test", "a" * 64, passwords)
        self.assertEqual(self.psql("CREATE TABLE public.preexisting_fixture (id integer); INSERT INTO public.preexisting_fixture VALUES (17);").returncode, 0)
        self.assertNotEqual(self.psql(sql).returncode, 0, "nonempty database must be refused")
        result = self.psql("DO $$ BEGIN IF (SELECT count(*) FROM public.preexisting_fixture WHERE id=17) <> 1 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lastochka_migrator') THEN RAISE EXCEPTION 'fixture changed'; END IF; END $$;")
        self.assertEqual(result.returncode, 0, "refusal must preserve existing rows and not create roles")
        self.assertEqual(self.psql("DROP TABLE public.preexisting_fixture;").returncode, 0)
        self.assertEqual(self.psql(sql).returncode, 0)
        self.assertNotEqual(self.psql(sql).returncode, 0, "repeat provisioning must fail")
        # All objects below exist only in the private fixture, never a bound host port or volume.
        self.assertEqual(self.psql("SET ROLE lastochka_migrator; CREATE TABLE public.fixture (id integer); INSERT INTO public.fixture VALUES (1); CREATE TABLE public.flyway_schema_history (version text, success boolean); INSERT INTO public.flyway_schema_history VALUES ('21', true);").returncode, 0)
        self.assertNotEqual(self.psql(MODULE.build_grants_sql("production", "a" * 64, "21")).returncode, 0)
        self.assertNotEqual(self.psql("SET ROLE lastochka_runtime; SELECT * FROM public.fixture;").returncode, 0)
        self.assertEqual(self.psql(MODULE.build_grants_sql("test", "a" * 64, "21")).returncode, 0)
        self.assertEqual(self.psql("SET ROLE lastochka_runtime; INSERT INTO public.fixture VALUES (2); SELECT * FROM deploy_guard.identity;").returncode, 0)
        self.assertEqual(self.psql("SET ROLE lastochka_reader; SELECT * FROM public.fixture;").returncode, 0)
        for sql in ("SET ROLE lastochka_reader; DELETE FROM public.fixture;", "SET ROLE lastochka_reader; DROP TABLE public.fixture;", "SET ROLE lastochka_runtime; DROP TABLE public.fixture;", "SET ROLE lastochka_runtime; TRUNCATE public.fixture;", "SET ROLE lastochka_runtime; SELECT * FROM public.flyway_schema_history;", "SET ROLE lastochka_runtime; UPDATE deploy_guard.identity SET environment='production';", "SET ROLE lastochka_migrator; UPDATE deploy_guard.identity SET environment='production';"):
            self.assertNotEqual(self.psql(sql).returncode, 0, sql)
        # Test the generated SCRAM verifier over TCP inside the fixture namespace.
        result = subprocess.run(["docker", "exec", "-e", "PGPASSWORD=synthetic-1-password", self.name, "psql", "-h", "127.0.0.1", "-U", "lastochka_runtime", "-d", "lastochka", "-c", "SELECT 1"], capture_output=True)
        self.assertEqual(result.returncode, 0)

    def test_bad_identity_and_duplicate_passwords_are_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.build_sql("test", "not-an-identity", {role: b"same" for role in MODULE.ROLES})
        with self.assertRaises(ValueError):
            MODULE.build_sql("test", "a" * 64, {role: b"same" for role in MODULE.ROLES})

    def test_target_guard_rejects_cross_environment_and_bad_mounts(self):
        machine = b"fixture-machine"
        manifest = {"environment": "test", "container": "lastochka-test-postgres-1", "volume": "lastochka-test-postgres", "identity": "a" * 64, "postgres_image_id": "sha256:" + "b" * 64, "machine_id_sha256": hashlib.sha256(machine).hexdigest()}
        container = {"State": {"Running": True}, "Image": manifest["postgres_image_id"], "Config": {"Labels": {"com.docker.compose.project": "lastochka-test"}}, "Mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "volume", "Name": manifest["volume"]}], "NetworkSettings": {"Networks": {"lastochka-test_default": {}}}, "HostConfig": {"PortBindings": {}}}
        volume = {"Labels": {"org.lastochka.environment": "test", "org.lastochka.identity": manifest["identity"]}}
        MODULE.validate_manifest("test", manifest, machine)
        MODULE.validate_inspection("test", manifest, container, volume)
        with self.assertRaises(ValueError):
            MODULE.validate_manifest("production", manifest, machine)
        with self.assertRaises(ValueError):
            MODULE.validate_manifest("test", manifest, b"another-host")
        bad = copy.deepcopy(container)
        bad["Mounts"][0]["Name"] = "lastochka-production-postgres"
        with self.assertRaises(ValueError):
            MODULE.validate_inspection("test", manifest, bad, volume)
        bad = copy.deepcopy(container)
        bad["NetworkSettings"]["Networks"]["lastochka-production_default"] = {}
        with self.assertRaises(ValueError):
            MODULE.validate_inspection("test", manifest, bad, volume)
        bad = copy.deepcopy(container)
        bad["HostConfig"]["PortBindings"] = {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5432"}]}
        with self.assertRaises(ValueError):
            MODULE.validate_inspection("test", manifest, bad, volume)
        bad_volume = copy.deepcopy(volume)
        bad_volume["Labels"]["org.lastochka.identity"] = "c" * 64
        with self.assertRaises(ValueError):
            MODULE.validate_inspection("test", manifest, container, bad_volume)


if __name__ == "__main__":
    unittest.main()
