#!/usr/bin/env python3
"""Provision DB roles once, only on a verified empty environment volume."""

import argparse
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
from pathlib import Path

ROLES = ("lastochka_migrator", "lastochka_runtime", "lastochka_reader")
LOCK_SPEC = importlib.util.spec_from_file_location("isolated_db_lock", Path(__file__).with_name("isolated-db-lock.py"))
LOCK = importlib.util.module_from_spec(LOCK_SPEC)
LOCK_SPEC.loader.exec_module(LOCK)


def private_file(path: Path) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("Secret must be a root-owned regular file with mode 0600")
    value = path.read_bytes()
    if not 16 <= len(value) <= 128 or not re.fullmatch(rb"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid generated database password")
    return value


def scram(password: bytes) -> str:
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password, salt, 4096)
    client = hmac.digest(salted, b"Client Key", "sha256")
    stored = hashlib.sha256(client).digest()
    server = hmac.digest(salted, b"Server Key", "sha256")
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return f"SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}"


def build_sql(zone: str, identity: str, passwords: dict[str, bytes]) -> str:
    if zone not in ("test", "production") or not re.fullmatch(r"[0-9a-f]{64}", identity):
        raise ValueError("Invalid environment identity")
    if set(passwords) != set(ROLES) or len(set(passwords.values())) != len(ROLES):
        raise ValueError("Database roles require distinct passwords")
    hashes = {role: scram(passwords[role]) for role in ROLES}
    create_roles = "\n".join(
        f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{hashes[role]}';"
        for role in ROLES
    )
    return f"""\\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
    IF current_database() <> 'lastochka' OR current_user <> 'postgres' THEN
        RAISE EXCEPTION 'Unexpected database or bootstrap role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','S','f'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname <> 'information_schema')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname <> 'information_schema' AND t.typtype IN ('d','e','c'))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='deploy_guard')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('lastochka_migrator','lastochka_runtime','lastochka_reader')) THEN
        RAISE EXCEPTION 'Database is not a fresh bootstrap target';
    END IF;
END
$guard$;
{create_roles}
CREATE SCHEMA deploy_guard AUTHORIZATION postgres;
CREATE TABLE deploy_guard.identity (environment text NOT NULL, identifier text NOT NULL);
INSERT INTO deploy_guard.identity VALUES ('{zone}', '{identity}');
REVOKE ALL ON SCHEMA deploy_guard FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA deploy_guard FROM PUBLIC;
GRANT USAGE ON SCHEMA deploy_guard TO lastochka_migrator, lastochka_runtime, lastochka_reader;
GRANT SELECT ON deploy_guard.identity TO lastochka_migrator, lastochka_runtime, lastochka_reader;
ALTER DATABASE lastochka OWNER TO lastochka_migrator;
REVOKE ALL ON DATABASE lastochka FROM PUBLIC;
GRANT CONNECT ON DATABASE lastochka TO lastochka_migrator, lastochka_runtime, lastochka_reader;
ALTER SCHEMA public OWNER TO lastochka_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lastochka_runtime, lastochka_reader;
COMMIT;
"""


def build_grants_sql(zone: str, identity: str, schema_version: str) -> str:
    if zone not in ("test", "production") or not re.fullmatch(r"[0-9a-f]{64}", identity) or not re.fullmatch(r"[1-9][0-9]{0,5}", schema_version):
        raise ValueError("Invalid target identity or schema version")
    return f"""\\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
    IF current_database() <> 'lastochka' OR current_user <> 'postgres'
       OR (SELECT count(*) FROM deploy_guard.identity) <> 1
       OR NOT EXISTS (SELECT 1 FROM deploy_guard.identity WHERE environment='{zone}' AND identifier='{identity}')
       OR to_regclass('public.flyway_schema_history') IS NULL THEN
        RAISE EXCEPTION 'Wrong database identity or missing migration history';
    END IF;
    IF EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE success = false)
       OR NOT EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version='{schema_version}' AND success = true)
       OR EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IS NOT NULL AND version !~ '^[0-9]+$')
       OR EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE CASE WHEN version ~ '^[0-9]+$' THEN version::numeric > {schema_version} ELSE false END) THEN
        RAISE EXCEPTION 'Unexpected schema history';
    END IF;
END
$guard$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lastochka_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lastochka_reader;
REVOKE ALL ON TABLE public.flyway_schema_history FROM lastochka_runtime, lastochka_reader;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lastochka_runtime;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO lastochka_reader;
COMMIT;
"""


def validate_manifest(zone: str, data: dict, machine_id: bytes) -> tuple[str, str, str]:
    expected_container = f"lastochka-{zone}-postgres-1"
    expected_volume = f"lastochka-{zone}-postgres"
    identity = data.get("identity", "")
    image_id = data.get("postgres_image_id", "")
    if (zone not in ("production", "test") or data.get("environment") != zone or data.get("container") != expected_container
            or data.get("volume") != expected_volume or not re.fullmatch(r"[0-9a-f]{64}", identity)
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id)
            or not machine_id or data.get("machine_id_sha256") != hashlib.sha256(machine_id).hexdigest()):
        raise ValueError("Target manifest does not match this environment and host")
    return expected_container, expected_volume, identity


def validate_inspection(zone: str, data: dict, container: dict, volume: dict) -> None:
    expected_volume = f"lastochka-{zone}-postgres"
    identity = data["identity"]
    image_id = data["postgres_image_id"]
    labels = volume.get("Labels") or {}
    mounts = [m for m in container.get("Mounts", []) if m.get("Destination") == "/var/lib/postgresql/data"]
    networks = container.get("NetworkSettings", {}).get("Networks") or {}
    bindings = container.get("HostConfig", {}).get("PortBindings") or {}
    if (not container.get("State", {}).get("Running") or container.get("Image") != image_id
            or (container.get("Config", {}).get("Labels") or {}).get("com.docker.compose.project") != f"lastochka-{zone}"
            or len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != expected_volume
            or set(networks) != {f"lastochka-{zone}_default"} or bindings
            or labels.get("org.lastochka.environment") != zone or labels.get("org.lastochka.identity") != identity):
        raise ValueError("Container, volume, network or identity does not match manifest")


def verify_target(zone: str) -> tuple[str, str]:
    directory = Path("/etc/lastochka") / zone
    manifest = directory / "target.json"
    for path in (Path("/etc/lastochka"), directory):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("Target directory must be root-owned and not writable by others")
    info = manifest.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("Target manifest must be a protected root-owned regular file")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    machine_id = Path("/etc/machine-id").read_bytes().strip()
    expected_container, expected_volume, identity = validate_manifest(zone, data, machine_id)
    def inspect(kind: str, name: str) -> dict:
        result = subprocess.run(["/usr/bin/docker", kind, "inspect", name], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)[0]
    container = inspect("container", expected_container)
    volume = inspect("volume", expected_volume)
    validate_inspection(zone, data, container, volume)
    return expected_container, identity


def provision(zone: str, phase: str) -> None:
    container, identity = verify_target(zone)
    directory = Path("/etc/lastochka") / zone
    if phase == "bootstrap":
        passwords = {role: private_file(directory / f"{role}.password") for role in ROLES}
        sql = build_sql(zone, identity, passwords)
    else:
        manifest = json.loads((directory / "target.json").read_text(encoding="utf-8"))
        sql = build_grants_sql(zone, identity, str(manifest.get("schema_version", "")))
    result = subprocess.run(["/usr/bin/docker", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit("Database role provisioning failed; inspect target safely before retrying")
    print("Database bootstrap completed" if phase == "bootstrap" else "Runtime privileges granted on verified schema")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zone", choices=("production", "test"), required=True)
    parser.add_argument("--phase", choices=("bootstrap", "grant"), default="bootstrap")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Provisioning requires the separately controlled root operator")
    with LOCK.exclusive_lock(args.zone):
        provision(args.zone, args.phase)


if __name__ == "__main__":
    main()
