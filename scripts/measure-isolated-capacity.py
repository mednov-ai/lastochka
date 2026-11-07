#!/usr/bin/env python3
"""Measure an additional synthetic stack and real backup without touching its DB.

The temporary PostgreSQL uses tmpfs only, no published port, and an internal
network. Only resources carrying this execution's random nonce are removed.
"""

import json
import secrets
import subprocess
import sys
import time

DOCKER = "/usr/bin/docker"


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def sample():
    values = {}
    with open("/proc/meminfo", encoding="ascii") as source:
        for line in source:
            name, value = line.split(":", 1)
            if name in ("MemAvailable", "SwapTotal", "SwapFree"):
                values[name] = int(value.split()[0])
    return values["MemAvailable"] // 1024, (values["SwapTotal"] - values["SwapFree"]) // 1024


def main():
    nonce = secrets.token_hex(12)
    prefix = f"lastochka-capacity-{nonce}"
    network = prefix + "-net"
    label = f"org.lastochka.capacity-nonce={nonce}"
    created = []
    network_created = False
    minimum = None
    maximum_swap = 0

    def observe():
        nonlocal minimum, maximum_swap
        available, swap = sample()
        minimum = available if minimum is None else min(minimum, available)
        maximum_swap = max(maximum_swap, swap)
        if available < 128:
            raise RuntimeError("Capacity fixture stopped: less than 128 MiB available")

    def start(name, image, options):
        container = f"{prefix}-{name}"
        run([DOCKER, "run", "-d", "--name", container, "--network", network,
             "--label", label, *options, image])
        created.append(container)
        return container

    def ready(container, command, timeout=180):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            observe()
            if subprocess.run([DOCKER, "exec", container, *command], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                return
            if run([DOCKER, "inspect", "-f", "{{.State.Running}}", container]) != "true":
                raise RuntimeError("Synthetic service exited before becoming ready")
            time.sleep(3)
        raise RuntimeError("Synthetic service did not become ready")

    try:
        if subprocess.run([DOCKER, "network", "inspect", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise RuntimeError("Synthetic network name collision")
        run([DOCKER, "network", "create", "--internal", "--label", label, network]); network_created = True
        postgres = start("postgres", "postgres:17.6-alpine", ["--network-alias", "postgres", "--memory", "192m", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "-e", "POSTGRES_DB=lastochka", "-e", "POSTGRES_PASSWORD=synthetic-fixture-password"])
        ready(postgres, ["pg_isready", "-U", "postgres", "-d", "lastochka"])
        backend = start("backend", "lastochka-backend:isolated-v1", ["--network-alias", "backend", "--memory", "448m", "-e", "SPRING_PROFILES_ACTIVE=preview", "-e", "DATABASE_URL=jdbc:postgresql://postgres:5432/lastochka", "-e", "DATABASE_USER=postgres", "-e", "DATABASE_PASSWORD=synthetic-fixture-password", "-e", "ADMIN_ACCESS_GENERATION=" + secrets.token_urlsafe(32), "-e", "LASTOCHKA_WORKERS_ENABLED=false", "-e", "LASTOCHKA_ALFA_ENABLED=false", "-e", "PUBLIC_APP_URL=https://fixture.invalid/lastochka/", "-e", "WEBAUTHN_ORIGIN=https://fixture.invalid", "-e", "WEBAUTHN_RP_ID=fixture.invalid", "-e", "COOKIE_SECURE=true", "-e", "JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=35.0"])
        ready(backend, ["bash", "/app/healthcheck.sh"], timeout=240)
        frontend = start("frontend", "lastochka-frontend:isolated-v1", ["--memory", "128m", "--tmpfs", "/app/public-assets:rw,size=64m,uid=1000,gid=1000", "-e", "APP_BASE_PATH=/lastochka", "-e", "BACKEND_INTERNAL_URL=http://backend:8080/lastochka", "-e", "PUBLIC_APP_URL=https://fixture.invalid/lastochka/"])
        ready(frontend, ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])
        backup = subprocess.Popen(["/usr/bin/systemctl", "start", "lastochka-production-backup.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while backup.poll() is None:
            observe(); time.sleep(1)
        if backup.returncode:
            raise RuntimeError("Production backup failed during capacity measurement")
        observe()
        stats = run([DOCKER, "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"])
        print(f"Synthetic second stack and verified backup: minimum available {minimum} MiB; maximum swap {maximum_swap} MiB")
        print(stats)
        print("No representative user load was applied; this is not a load-test guarantee.")
    except BaseException:
        print(f"Capacity check interrupted: minimum available {minimum} MiB; maximum swap {maximum_swap} MiB", file=sys.stderr)
        raise
    finally:
        for container in reversed(created):
            try:
                info = json.loads(run([DOCKER, "container", "inspect", container]))[0]
                labels = info.get("Config", {}).get("Labels") or {}
                mounts = info.get("Mounts") or []
                if labels.get("org.lastochka.capacity-nonce") != nonce or any(m.get("Type") == "volume" for m in mounts):
                    raise RuntimeError("Fixture container ownership mismatch")
                run([DOCKER, "rm", "-f", container])
            except Exception as error:
                print(f"Fixture cleanup failed: {type(error).__name__}", file=sys.stderr)
                raise
        if network_created:
            info = json.loads(run([DOCKER, "network", "inspect", network]))[0]
            if (info.get("Labels") or {}).get("org.lastochka.capacity-nonce") != nonce or info.get("Containers"):
                raise RuntimeError("Fixture network ownership mismatch")
            run([DOCKER, "network", "rm", network])


if __name__ == "__main__":
    main()
