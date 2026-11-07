#!/usr/bin/env python3
"""End-to-end migration/role/bootstrap check in a private synthetic Docker network."""

import importlib.util
import os
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("isolated_db", ROOT / "scripts/provision-isolated-db.py")
DB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DB)
MIG_SPEC = importlib.util.spec_from_file_location("isolated_migration", ROOT / "scripts/migrate-isolated-db.py")
MIG = importlib.util.module_from_spec(MIG_SPEC)
MIG_SPEC.loader.exec_module(MIG)
BACKUP_SPEC = importlib.util.spec_from_file_location("production_backup", ROOT / "scripts/backup-production-db.py")
BACKUP = importlib.util.module_from_spec(BACKUP_SPEC)
BACKUP_SPEC.loader.exec_module(BACKUP)
BACKUP.DOCKER = shutil.which("docker")


def command(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, **kwargs)


def check_backend_compatibility(network: str, runtime_password: Path):
    """Old -> new -> old on one synthetic V21 database and one session."""
    names = []
    suffix = secrets.token_hex(6)
    try:
        for alias, image in (("old", "lastochka-backend:0.19.3-flat"), ("new", "lastochka-backend:epoch-v1")):
            name = f"lastochka-compat-fixture-{suffix}-{alias}"
            result = command(["docker", "run", "-d", "--name", name, "--network", network, "--network-alias", alias,
                              "--memory", "512m", "-e", "SPRING_PROFILES_ACTIVE=preview", "-e", "SPRING_FLYWAY_ENABLED=false",
                              "-e", "SPRING_CONFIG_IMPORT=configtree:/run/runtime-config/",
                              "-e", "DATABASE_URL=jdbc:postgresql://postgres:5432/lastochka", "-e", "DATABASE_USER=lastochka_runtime",
                              "-e", "ADMIN_ACCESS_GENERATION=" + "synthetic-generation-" + "x" * 32,
                              "-e", "LASTOCHKA_WORKERS_ENABLED=false", "-e", "LASTOCHKA_ALFA_ENABLED=false",
                              "-e", "PUBLIC_APP_URL=http://localhost:18080/lastochka/", "-e", "WEBAUTHN_ORIGIN=http://localhost:18080",
                              "-e", "WEBAUTHN_RP_ID=localhost", "-e", "COOKIE_SECURE=false", "-e", "APP_BASE_PATH=/lastochka",
                              "-e", "JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=35.0",
                              "-v", f"{runtime_password}:/run/runtime-config/spring.datasource.password:ro", image])
            if result.returncode:
                raise RuntimeError("Could not start synthetic compatibility backend")
            names.append(name)
        for name in names:
            for _ in range(150):
                if command(["docker", "exec", name, "bash", "/app/healthcheck.sh"]).returncode == 0:
                    break
                state = command(["docker", "inspect", "-f", "{{.State.Running}}", name])
                if state.stdout.strip() != "true":
                    raise RuntimeError("Synthetic compatibility backend exited")
                time.sleep(2)
            else:
                raise RuntimeError("Synthetic compatibility backend timed out")
        javascript = r"""
const cookies = new Map();
async function call(host,path,method='GET',data=null,headers={}) {
  const cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
  const r=await fetch(`http://${host}:8080/lastochka${path}`,{method,headers:{...headers,...(cookie?{cookie}:{})},body:data});
  for(const s of r.headers.getSetCookie()){const [pair]=s.split(';');const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1))}
  if(!r.ok)throw Error(`Unexpected HTTP ${r.status} at ${path}`);
  return r.json();
}
const csrf=await call('old','/api/v1/auth/csrf');
const login=await call('old','/api/v1/auth/password-stage','POST',JSON.stringify({login:'kines',password:'fixture-admin-password-123'}),{'content-type':'application/json',[csrf.headerName]:csrf.token});
if(login.state!=='FULL')throw Error('Synthetic login failed');
for(const host of ['new','old']){const me=await call(host,'/api/v1/auth/me');if(me.state!=='FULL')throw Error('Session did not survive backend transition')}
console.log('Old -> new -> old backend session compatibility passed');
"""
        result = command(["docker", "run", "--rm", "--network", network, "node:24-alpine", "node", "--input-type=module", "-e", javascript], timeout=90)
        if result.returncode:
            raise RuntimeError("Synthetic compatibility check failed: " + result.stderr[-500:])
        print(result.stdout.strip())
    finally:
        for name in reversed(names):
            command(["docker", "rm", "-f", name])


def main():
    suffix = secrets.token_hex(6)
    network = f"lastochka-migration-fixture-{suffix}"
    postgres = f"{network}-postgres"
    created_network = False
    created_postgres = False
    passwords = {role: f"fixture-{index}-password".encode() for index, role in enumerate(DB.ROLES)}
    identity = "a" * 64
    with tempfile.TemporaryDirectory(prefix="lastochka-migration-fixture-") as temp:
        root = Path(temp)
        os.chmod(root, 0o755)
        migrations = root / "migrations"
        migrations.mkdir(mode=0o755)
        jar = ROOT / "backend/app/build/libs/app-0.1.0.jar"
        MIG.extract_migrations(jar, migrations, "21")
        expected = ROOT / "backend/app/src/main/resources/db/migration"
        assert {p.name for p in migrations.iterdir()} == {p.name for p in expected.glob("*.sql")}
        for path in migrations.iterdir():
            assert path.read_bytes() == (expected / path.name).read_bytes(), path.name
        runtime_password = root / "runtime-password"
        bootstrap_password = root / "admin-password"
        runtime_password.write_bytes(passwords["lastochka_runtime"])
        bootstrap_password.write_text("fixture-admin-password-123")
        runtime_password.chmod(0o644)
        bootstrap_password.chmod(0o644)
        try:
            if command(["docker", "network", "create", "--internal", network]).returncode:
                raise RuntimeError("Could not create fixture network")
            created_network = True
            if command(["docker", "run", "-d", "--name", postgres, "--network", network, "--network-alias", "postgres", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "-e", "POSTGRES_DB=lastochka", "-e", "POSTGRES_PASSWORD=fixture-superuser-password", "postgres:17.6-alpine"]).returncode:
                raise RuntimeError("Could not create fixture PostgreSQL")
            created_postgres = True
            for _ in range(60):
                if command(["docker", "exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "lastochka"]).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Fixture PostgreSQL did not start")

            def sql(value):
                return command(["docker", "exec", "-i", postgres, "psql", "-X", "-qAt", "-U", "postgres", "-d", "lastochka", "-v", "ON_ERROR_STOP=1"], input=value)

            result = sql(DB.build_sql("test", identity, passwords))
            if result.returncode:
                raise RuntimeError("Fixture bootstrap failed")
            assert sql(MIG.baseline_state_sql()).stdout.strip() == f"test|{identity}|empty"
            config = "\n".join([
                "flyway.url=jdbc:postgresql://postgres:5432/lastochka",
                "flyway.user=lastochka_migrator",
                "flyway.password=" + passwords["lastochka_migrator"].decode(),
                "flyway.locations=filesystem:/flyway/sql",
                "flyway.cleanDisabled=true",
                "flyway.baselineOnMigrate=false",
            ]) + "\n"
            config_file = root / "flyway.conf"
            config_file.write_text(config)
            config_file.chmod(0o600)
            migration = command(["docker", "run", "--rm", "--network", network, "-v", f"{migrations}:/flyway/sql:ro", "-v", f"{config_file}:/run/flyway.conf:ro", "flyway/flyway:12.4.0", "-configFiles=/run/flyway.conf", "migrate"], timeout=180)
            if migration.returncode:
                raise RuntimeError("Fixture migration failed: " + (migration.stderr + migration.stdout).replace(passwords["lastochka_migrator"].decode(), "[redacted]")[-1500:])
            assert sql(MIG.baseline_state_sql()).stdout.strip() == f"test|{identity}|nonempty"
            result = sql(DB.build_grants_sql("test", identity, "21"))
            if result.returncode:
                raise RuntimeError("Fixture grant failed: " + result.stderr[-500:])
            history = sql("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL;")
            assert history.returncode == 0 and history.stdout.strip() == "21", history.stdout
            common = ["docker", "run", "--rm", "--network", network,
                      "-e", "SPRING_PROFILES_ACTIVE=preview", "-e", "SPRING_FLYWAY_ENABLED=false",
                      "-e", "SPRING_CONFIG_IMPORT=configtree:/run/runtime-config/",
                      "-e", "DATABASE_URL=jdbc:postgresql://postgres:5432/lastochka",
                      "-e", "DATABASE_USER=lastochka_runtime", "-e", "ADMIN_ACCESS_GENERATION=synthetic-generation-123456",
                      "-e", "LASTOCHKA_WORKERS_ENABLED=false", "-e", "PUBLIC_APP_URL=http://localhost:18080/lastochka/",
                      "-e", "WEBAUTHN_ORIGIN=http://localhost:18080", "-e", "WEBAUTHN_RP_ID=localhost",
                      "-e", "COOKIE_SECURE=false", "-e", "APP_BASE_PATH=/lastochka",
                      "-e", "LASTOCHKA_ADMIN_LOGIN=kines", "-e", "LASTOCHKA_ADMIN_NAME=Администратор",
                      "-e", "LASTOCHKA_ADMIN_PASSWORD_FILE=/run/admin-password",
                      "-v", f"{runtime_password}:/run/runtime-config/spring.datasource.password:ro",
                      "-v", f"{bootstrap_password}:/run/admin-password:ro", "lastochka-backend:isolated-local", "--lastochka.admin.create=true"]
            first = command(common, timeout=180)
            if first.returncode:
                raise RuntimeError("Fixture admin bootstrap failed: " + (first.stderr + first.stdout).replace("fixture-admin-password-123", "[redacted]")[-1500:])
            assert "fixture-admin-password-123" not in first.stdout + first.stderr
            before = sql("SELECT password_hash FROM accounts WHERE login='kines';")
            assert before.returncode == 0 and before.stdout.strip()
            second = command(common, timeout=180)
            assert second.returncode != 0, "repeated bootstrap must not reset an existing account"
            after = sql("SELECT password_hash FROM accounts WHERE login='kines';")
            assert before.stdout == after.stdout
            history_after = sql("SELECT count(*) FROM public.flyway_schema_history WHERE success AND version IS NOT NULL;")
            assert history_after.stdout.strip() == "21"
            postgres_image = command(["docker", "image", "inspect", "postgres:17.6-alpine", "--format", "{{.Id}}"])
            assert postgres_image.returncode == 0
            backup = BACKUP.verified_dump(postgres, postgres_image.stdout.strip(), root)
            assert backup.is_file() and backup.stat().st_size > 0
            check_backend_compatibility(network, runtime_password)
            print("Isolated Flyway, roles, file bootstrap, repeat guard and full backup restore: passed")
        finally:
            if created_postgres:
                command(["docker", "rm", "-f", postgres])
            if created_network:
                command(["docker", "network", "rm", network])


if __name__ == "__main__":
    main()
