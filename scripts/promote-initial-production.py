#!/usr/bin/env python3
"""Prepare or explicitly approve the initial, already-migrated production release.

This tool never applies database migrations or restores a database. Later schema
changes need a separately reviewed compatibility and migration procedure.
"""

import argparse
import importlib.util
import json
import os
import re
import stat
import subprocess
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("isolated_db", HERE / "provision-isolated-db.py")
DB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DB)
ROOT = HERE.parent
DOCKER = "/usr/bin/docker"


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError("Release check or command failed; production was not exposed")
    return result.stdout.strip()


def compose(zone):
    return [DOCKER, "compose", "--project-name", f"lastochka-{zone}", "--env-file",
            f"/etc/lastochka/{zone}/compose.env", "-f", str(ROOT / "compose.isolated.yaml")]


def inspect(kind, name):
    return json.loads(run([DOCKER, kind, "inspect", name]))[0]


def check(zone):
    container, identity = DB.verify_target(zone)
    manifest = json.loads((Path("/etc/lastochka") / zone / "target.json").read_text())
    schema = str(manifest.get("schema_version", ""))
    if not re.fullmatch(r"[1-9][0-9]{0,5}", schema):
        raise ValueError("Invalid schema version")
    sql = ("SELECT environment || '|' || identifier || '|' || "
           "(SELECT max(version::integer) FROM public.flyway_schema_history WHERE success AND version ~ '^[0-9]+$') || '|' || "
           "(SELECT count(*) FROM public.flyway_schema_history WHERE NOT success) || '|' || "
           "(SELECT count(*) FROM public.flyway_schema_history WHERE success AND version ~ '^[0-9]+$') "
           "FROM deploy_guard.identity;")
    marker = run([DOCKER, "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=sql)
    if schema != "21" or marker != f"{zone}|{identity}|21|0|21":
        raise ValueError("Database identity or schema mismatch")
    settings = json.loads(run(compose(zone) + ["config", "--format", "json"]))
    return manifest, settings


def validate():
    test, test_config = check("test")
    prod, prod_config = check("production")
    if test["identity"] == prod["identity"] or test["volume"] == prod["volume"]:
        raise ValueError("Environments are not isolated")
    if test["schema_version"] != prod["schema_version"] or test["backend_image_id"] != prod["backend_image_id"]:
        raise ValueError("Test and production backend or schema differ")
    for service in ("backend", "frontend", "gate", "proxy"):
        current = inspect("container", f"lastochka-test-{service}-1")
        expected = prod_config["services"][service]["image"]
        state = current.get("State", {})
        if (current.get("Image") != expected or not state.get("Running")
                or (service in ("backend", "frontend") and state.get("Health", {}).get("Status") != "healthy")):
            raise ValueError(f"Test {service} is not healthy on the expected immutable image")
        if expected != test_config["services"][service]["image"]:
            raise ValueError("Test and production artifacts differ")
        if service in ("backend", "frontend"):
            labels = inspect("image", expected).get("Config", {}).get("Labels") or {}
            if labels.get("org.lastochka.schema.min") != "21" or labels.get("org.lastochka.schema.max") != "21":
                raise ValueError("Artifact does not declare compatibility with schema V21")
    evidence_path = Path("/etc/lastochka/production/candidate-verification.json")
    try:
        evidence_info = evidence_path.lstat()
    except FileNotFoundError:
        raise ValueError("Source and capacity verification for this candidate is not recorded") from None
    if (not stat.S_ISREG(evidence_info.st_mode) or evidence_info.st_uid != 0
            or stat.S_IMODE(evidence_info.st_mode) != 0o600):
        raise ValueError("Candidate verification must be a protected root-owned file")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if (evidence.get("backend_image_id") != prod_config["services"]["backend"]["image"]
            or evidence.get("frontend_image_id") != prod_config["services"]["frontend"]["image"]
            or evidence.get("gate_image_id") != prod_config["services"]["gate"]["image"]
            or not re.fullmatch(r"[0-9a-f]{40}", evidence.get("source_commit", ""))
            or evidence.get("source_reproducible") is not True
            or evidence.get("capacity_baseline_verified") is not True
            or evidence.get("rollback_compatibility_verified") is not True):
        raise ValueError("Candidate source, capacity or rollback evidence does not match these artifacts")
    if prod_config["services"]["backend"]["environment"].get("SPRING_FLYWAY_ENABLED") != "false":
        raise ValueError("Production runtime must not run Flyway")
    if prod_config["services"]["backend"]["environment"].get("LASTOCHKA_ALFA_ENABLED") != "false":
        raise ValueError("Production bank integration must be disabled")
    for service in ("postgres", "backend", "frontend"):
        if prod_config["services"][service].get("ports"):
            raise ValueError("Unexpected production service port")
    for service, expected_port in (("proxy", "18080"), ("gate", "18180")):
        ports = prod_config["services"][service].get("ports", [])
        if len(ports) != 1 or ports[0].get("host_ip") != "127.0.0.1" or str(ports[0].get("published")) != expected_port:
            raise ValueError("Unexpected production loopback port")
    if run(["/usr/bin/systemctl", "is-active", "lastochka-production-backup.timer"]) != "active":
        raise ValueError("Production backup timer is not active")
    if run(["/usr/bin/systemctl", "show", "lastochka-production-backup.service", "--property=Result", "--value"]) != "success":
        raise ValueError("No successful production backup")
    backups = list(Path("/opt/lastochka/backups/production").glob("lastochka-production-*.dump"))
    if not backups or not any(p.is_file() and not p.is_symlink() and p.stat().st_size > 0 and time.time() - p.stat().st_mtime < 48 * 3600 for p in backups):
        raise ValueError("No recent production backup archive")
    return prod["backend_image_id"]


def apply(image):
    site = Path("/etc/nginx/sites-available/lastochka-production")
    enabled = Path("/etc/nginx/sites-enabled/lastochka-production")
    if site.exists() or site.is_symlink() or enabled.exists() or enabled.is_symlink():
        raise ValueError("Existing production vhost requires an explicitly reviewed procedure")
    # Refresh and restore-check a backup before starting the production application.
    run(["/usr/bin/systemctl", "start", "lastochka-production-backup.service"], timeout=600)
    with DB.LOCK.exclusive_lock("production"):
        finalize_release(image)


def finalize_release(image):
    site = Path("/etc/nginx/sites-available/lastochka-production")
    enabled = Path("/etc/nginx/sites-enabled/lastochka-production")
    if validate() != image:
        raise ValueError("Target changed after backup")
    run(compose("production") + ["up", "-d"], timeout=600)
    # Only the loopback gate and proxy exist until all prerequisites have succeeded.
    if site.exists() or site.is_symlink() or enabled.exists() or enabled.is_symlink():
        raise ValueError("Existing production vhost requires an explicitly reviewed procedure")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for port, path in ((18180, "/__gate/"), (18080, "/lastochka/")):
        with opener.open(urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Host": "lastochka-gym.ru"}), timeout=15) as response:
            if response.status != 200:
                raise RuntimeError("Production loopback readiness failed")
    rendered = run(["/usr/bin/python3", str(HERE / "render-gate-nginx.py"), "--environment", "production", "--app-port", "18080", "--gate-port", "18180", "--certificate", "/etc/letsencrypt/live/lastochka-gym.ru/fullchain.pem", "--certificate-key", "/etc/letsencrypt/live/lastochka-gym.ru/privkey.pem", "--acme-root", "/var/www/lastochka-acme"])
    fd = os.open(site, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(rendered + "\n"); output.flush(); os.fsync(output.fileno())
        os.symlink(site, enabled)
        try:
            run(["/usr/sbin/nginx", "-t"])
            run(["/usr/bin/systemctl", "reload", "nginx"])
        except BaseException:
            enabled.unlink(missing_ok=True)
            raise
    except BaseException:
        # Do not touch any database, image, previous backup, or existing vhost.
        raise
    print("Initial production release exposed behind its separate gate")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approve-image", default="")
    args = parser.parse_args()
    if args.apply and not re.fullmatch(r"sha256:[0-9a-f]{64}", args.approve_image):
        raise SystemExit("Explicit owner approval of the exact tested image is required")
    if os.geteuid() != 0:
        raise SystemExit("Release checks require the separately controlled root operator")
    image = validate()
    print("Tested backend image: " + image, flush=True)
    print("Initial schema is already present; no migrations or data restores will run", flush=True)
    if args.apply:
        if args.approve_image != image:
            raise SystemExit("Approval does not match the tested image")
        apply(image)


if __name__ == "__main__":
    main()
