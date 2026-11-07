#!/usr/bin/env python3
"""Run the initial Flyway baseline only against a verified empty isolated DB."""

import argparse
import importlib.util
import json
import os
import re
import secrets
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("isolated_db", Path(__file__).with_name("provision-isolated-db.py"))
DB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DB)
LOCK_SPEC = importlib.util.spec_from_file_location("isolated_db_lock", Path(__file__).with_name("isolated-db-lock.py"))
LOCK = importlib.util.module_from_spec(LOCK_SPEC)
LOCK_SPEC.loader.exec_module(LOCK)
DOCKER = "/usr/bin/docker"


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError("Protected migration command failed; inspect the target before retrying")
    return result.stdout.strip()


def extract_migrations(jar: Path, directory: Path, expected_version: str) -> None:
    if not re.fullmatch(r"[1-9][0-9]{0,5}", expected_version):
        raise ValueError("Invalid expected schema version")
    names = set()
    versions = set()
    with zipfile.ZipFile(jar) as archive:
        for entry in archive.infolist():
            prefix = "BOOT-INF/classes/db/migration/"
            if not entry.filename.startswith(prefix) or not entry.filename.endswith(".sql"):
                continue
            filename = entry.filename.removeprefix(prefix)
            match = re.fullmatch(r"V([1-9][0-9]*)__[A-Za-z0-9_-]+\.sql", filename)
            if not match or filename in names or int(match.group(1)) in versions or entry.file_size > 2_000_000:
                raise ValueError("Invalid or duplicate migration in backend image")
            names.add(filename)
            versions.add(int(match.group(1)))
            (directory / filename).write_bytes(archive.read(entry))
    if not versions or max(versions) != int(expected_version):
        raise ValueError("Migration bundle and expected schema do not match")


def baseline_state_sql() -> str:
    return """SELECT environment || '|' || identifier || '|' ||
      CASE WHEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
          AND n.nspname NOT IN ('information_schema','deploy_guard')
          AND c.relkind IN ('r','p','v','m','S','f')
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','deploy_guard')
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','deploy_guard') AND t.typtype IN ('d','e','c')
      ) THEN 'nonempty' ELSE 'empty' END
      FROM deploy_guard.identity;"""


def run_psql(container: str, sql: str) -> str:
    return run([DOCKER, "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql)


def migrate(zone: str) -> None:
    container, identity = DB.verify_target(zone)
    directory = Path("/etc/lastochka") / zone
    manifest = json.loads((directory / "target.json").read_text(encoding="utf-8"))
    version = str(manifest.get("schema_version", ""))
    backend_image = manifest.get("backend_image_id", "")
    flyway_image = manifest.get("flyway_image_id", "")
    if not all(re.fullmatch(r"sha256:[0-9a-f]{64}", image) for image in (backend_image, flyway_image)):
        raise SystemExit("Immutable backend and Flyway image IDs are required")
    if run_psql(container, baseline_state_sql()) != f"{zone}|{identity}|empty":
        raise SystemExit("Refusing baseline migration on a nonempty or mismatched database")
    network = f"lastochka-{zone}_default"
    inspected_network = json.loads(run([DOCKER, "network", "inspect", network]))[0]
    inspected_container = json.loads(run([DOCKER, "container", "inspect", container]))[0]
    if set((inspected_network.get("Containers") or {}).keys()) != {inspected_container["Id"]}:
        raise SystemExit("Baseline migration requires an isolated network with only its database")
    if not inspected_network.get("Internal"):
        raise SystemExit("Baseline migration requires an internal Docker network")
    password = DB.private_file(directory / "lastochka_migrator.password").decode("ascii")
    work_root = Path("/run/lastochka-migration")
    work_root.mkdir(mode=0o700, exist_ok=True)
    info = work_root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise SystemExit("Migration work directory is not private")
    with tempfile.TemporaryDirectory(prefix=f"{zone}-", dir=work_root) as temporary:
        work = Path(temporary)
        migrations = work / "sql"
        migrations.mkdir(mode=0o755)
        jar = work / "app.jar"
        temporary_container = "lastochka-inspect-" + secrets.token_hex(12)
        created = False
        try:
            run([DOCKER, "create", "--name", temporary_container, "--network", "none", backend_image])
            created = True
            run([DOCKER, "cp", f"{temporary_container}:/app/app.jar", str(jar)])
        finally:
            if created:
                subprocess.run([DOCKER, "rm", "-f", temporary_container], capture_output=True, check=False)
        extract_migrations(jar, migrations, version)
        config = work / "flyway.conf"
        descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write("flyway.url=jdbc:postgresql://postgres:5432/lastochka\n")
            output.write("flyway.user=lastochka_migrator\n")
            output.write(f"flyway.password={password}\n")
            output.write("flyway.locations=filesystem:/flyway/sql\n")
            output.write("flyway.cleanDisabled=true\nflyway.baselineOnMigrate=false\n")
        # Re-check identity and isolation immediately before the only permitted migration command.
        DB.verify_target(zone)
        if run_psql(container, baseline_state_sql()) != f"{zone}|{identity}|empty":
            raise SystemExit("Target changed during migration preparation")
        current_network = json.loads(run([DOCKER, "network", "inspect", network]))[0]
        if not current_network.get("Internal") or set((current_network.get("Containers") or {}).keys()) != {inspected_container["Id"]}:
            raise SystemExit("Migration network changed during preparation")
        run([DOCKER, "run", "--rm", "--network", network, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "384m", "-v", f"{migrations}:/flyway/sql:ro", "-v", f"{config}:/run/flyway.conf:ro", flyway_image, "-configFiles=/run/flyway.conf", "migrate"], timeout=300)
        # Grant only business DML; history and deployment identity remain unavailable for writes.
        DB.verify_target(zone)
        run_psql(container, DB.build_grants_sql(zone, identity, version))
    print("Initial isolated migration and runtime grants completed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zone", choices=("production", "test"), required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Migration requires the separately controlled root operator")
    with LOCK.exclusive_lock(args.zone):
        migrate(args.zone)


if __name__ == "__main__":
    main()
