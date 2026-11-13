#!/usr/bin/env python3
"""Test V28 against disposable V27 data; uses internal-only Docker networking and fixture keys."""
from pathlib import Path
import base64
import os
import subprocess
import tempfile
import time
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parents[1]
TAG = uuid.uuid4().hex[:12]
NETWORK = f"lastochka-alfa-legacy-{TAG}"
DATABASE = f"lastochka-alfa-legacy-db-{TAG}"
APPLICATION = f"lastochka-alfa-legacy-app-{TAG}"
OWNER = f"{os.getuid()}:{os.getgid()}"
DB_NAME = "lastochka"


def run(*args, input_text=None, check=True):
    return subprocess.run(args, input=input_text, text=True, capture_output=True, check=check)


def docker(*args, **kwargs):
    return run("docker", *args, **kwargs)


def sql(query):
    result = docker("exec", "-i", DATABASE, "psql", "-U", "lastochka", "-d", DB_NAME,
                    "-v", "ON_ERROR_STOP=1", "-At", input_text=query, check=False)
    if result.returncode:
        raise RuntimeError("Synthetic SQL fixture failed: " + result.stderr[-1000:])
    return result.stdout.strip()


def wait_for_app(marker):
    for _ in range(200):
        logs = docker("logs", APPLICATION, check=False).stdout + docker("logs", APPLICATION, check=False).stderr
        if marker in logs:
            return logs
        status = docker("inspect", "-f", "{{.State.Status}}", APPLICATION, check=False).stdout.strip()
        if status == "exited":
            raise RuntimeError("Synthetic app exited before the expected migration result")
        time.sleep(0.5)
    raise RuntimeError("Synthetic app timed out")


def seal(environment, purpose, value):
    key = bytes(range(32))
    nonce = bytes(range(12))
    name = b"fixture"
    aad = f"lastochka:alfa:{environment}:{purpose}:fixture".encode()
    return (b"\x01" + len(name).to_bytes(2, "big") + name + nonce + AESGCM(key).encrypt(nonce, value, aad)).hex()


def app_start(path, target=None, unsafe_override=False):
    docker("rm", "-f", APPLICATION, check=False)
    args = ["run", "-d", "--name", APPLICATION, "--network", NETWORK, "--user", OWNER,
            "-e", "GRADLE_USER_HOME=/gradle-cache", "-e", "SPRING_PROFILES_ACTIVE=test",
            "-e", f"DATABASE_URL=jdbc:postgresql://fixture-db:5432/{DB_NAME}",
            "-e", "DATABASE_USER=lastochka", "-e", "DATABASE_PASSWORD=fixture-only",
            "-e", "BIND_ADDRESS=0.0.0.0", "-e", "APP_BASE_PATH=/lastochka",
            "-e", "LASTOCHKA_ALFA_KEY_DIRECTORY=/keys", "-e", "LASTOCHKA_ALFA_KEY_ID=fixture"]
    if target:
        args.extend(["-e", f"SPRING_FLYWAY_TARGET={target}"])
    if unsafe_override:
        args.extend(["-e", "SPRING_FLYWAY_ENABLED=false", "-e", "LASTOCHKA_ALFA_PRODUCTION_ALLOWED=true",
                     "-e", "LASTOCHKA_ALFA_DEPLOYMENT_ZONE=production"])
    args.extend(["-v", f"{path}/keys:/keys:ro", "-v", f"{Path.home()}/.gradle:/gradle-cache",
                 "-v", f"{path}/backend:/work", "-w", "/work", "gradle:9.5.1-jdk25",
                 "./gradlew", "--offline", "--no-daemon", ":app:bootRun"])
    docker(*args)


def run_migrator(path, zone="test", identifier="a" * 64):
    return docker("run", "--rm", "--network", NETWORK, "--user", OWNER,
                  "-e", f"LASTOCHKA_MIGRATION_ZONE={zone}", "-e", f"LASTOCHKA_MIGRATION_IDENTIFIER={identifier}",
                  "-e", "LASTOCHKA_MIGRATION_DB_URL=jdbc:postgresql://postgres:5432/lastochka",
                  "-e", "LASTOCHKA_MIGRATION_DB_USER=lastochka_migrator",
                  "-e", "LASTOCHKA_MIGRATION_PASSWORD_FILE=/run/migrator.password",
                  "-e", "LASTOCHKA_ALFA_KEY_DIRECTORY=/keys", "-v", f"{path}/keys:/keys:ro",
                  "-v", f"{path}/migrator.password:/run/migrator.password:ro",
                  "-v", f"{path}/backend/app/build/libs/app-0.1.0.jar:/app/app.jar:ro",
                  "gradle:9.5.1-jdk25", "java", "-Dloader.main=ru.lastochka.migration.AlfaV28TestMigration",
                  "-cp", "/app/app.jar", "org.springframework.boot.loader.launch.PropertiesLauncher", check=False)


try:
    with tempfile.TemporaryDirectory(prefix="lastochka-alfa-legacy-") as path:
        Path(path, "keys").mkdir()
        Path(path, "keys", "fixture.key").write_text(base64.b64encode(bytes(range(32))).decode())
        Path(path, "migrator.password").write_text("fixture-only\n")
        Path(path, "backend").mkdir()
        run("rsync", "-a", "--exclude", "build", "--exclude", ".gradle", str(ROOT / "backend") + "/", path + "/backend/")
        docker("network", "create", "--internal", NETWORK)
        docker("run", "-d", "--name", DATABASE, "--network", NETWORK, "--network-alias", "fixture-db", "--network-alias", "postgres",
               "-e", "POSTGRES_USER=lastochka", "-e", "POSTGRES_PASSWORD=fixture-only", "-e", "POSTGRES_DB=lastochka", "postgres:17.6-alpine")
        for _ in range(80):
            if docker("exec", DATABASE, "pg_isready", "-U", "lastochka", check=False).returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("Synthetic database failed to start")
        app_start(path, "27")
        wait_for_app("now at version v27")
        docker("stop", APPLICATION, check=False)
        docker("run", "--rm", "--network", "none", "--user", OWNER, "-e", "GRADLE_USER_HOME=/gradle-cache",
               "-v", f"{Path.home()}/.gradle:/gradle-cache", "-v", f"{path}/backend:/work", "-w", "/work",
               "gradle:9.5.1-jdk25", "./gradlew", "--offline", "--no-daemon", ":app:bootJar")
        sql("CREATE ROLE lastochka_migrator LOGIN PASSWORD 'fixture-only'; CREATE SCHEMA deploy_guard; CREATE TABLE deploy_guard.identity(environment text NOT NULL, identifier text NOT NULL); INSERT INTO deploy_guard.identity VALUES('test','" + "a" * 64 + "');")
        wrong = seal("PRODUCTION", "credentials", b"fixture only")
        sql(f"""
          INSERT INTO accounts(id,email,name,password_hash,role,login,admin_enabled) VALUES
            ('00000000-0000-4000-8000-000000000001','fixture@example.test','Fixture','fixture-hash','ADMIN','fixture',true);
          INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,created_by) VALUES
            ('00000000-0000-4000-8000-000000000002',100,'Fixture','Fixture','+79000000000','00000000-0000-4000-8000-000000000001');
          INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name) VALUES
            ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007',0,0,3600,9999999999999,'fixture');
          INSERT INTO alfa_credentials_versions(id,ciphertext,created_at,created_by) VALUES
            ('00000000-0000-4000-8000-000000000003',decode('{wrong}','hex'),now(),'00000000-0000-4000-8000-000000000001');
          UPDATE alfa_configuration SET active_version='00000000-0000-4000-8000-000000000003',enabled=true;
          INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,draft_version,amount_minor,purpose,operation_state) VALUES
            ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','fixture-order',1,100,'Fixture','OPEN');
        """)
        # Restore the synthetic V27 snapshot into a second database on this private container.
        snapshot = docker("exec", DATABASE, "pg_dump", "-U", "lastochka", "-d", DB_NAME,
                          "--no-owner", "--no-privileges").stdout
        docker("exec", DATABASE, "createdb", "-U", "lastochka", "fixture_restore")
        DB_NAME = "fixture_restore"
        sql(snapshot)
        sql("""
          DO $$ DECLARE object_row record; BEGIN
            FOR object_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
              EXECUTE format('ALTER TABLE public.%I OWNER TO lastochka_migrator', object_row.relname);
            END LOOP;
          END $$;
          ALTER SCHEMA public OWNER TO lastochka_migrator;
          GRANT USAGE ON SCHEMA deploy_guard TO lastochka_migrator;
          GRANT SELECT ON deploy_guard.identity TO lastochka_migrator;
        """)
        # The guarded runner accepts only the normal isolated database name and hostname.
        docker("exec", DATABASE, "psql", "-U", "lastochka", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "ALTER DATABASE lastochka RENAME TO fixture_source")
        docker("exec", DATABASE, "psql", "-U", "lastochka", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "ALTER DATABASE fixture_restore RENAME TO lastochka")
        DB_NAME = "lastochka"
        assert run_migrator(path, zone="production").returncode != 0
        assert run_migrator(path, identifier="b" * 64).returncode != 0
        for malformed in ("credentials", "link"):
            if malformed == "link":
                valid = seal("TEST", "credentials", b"fixture only")
                sql(f"UPDATE alfa_credentials_versions SET ciphertext=decode('{valid}','hex'); UPDATE alfa_test_attempts SET link_ciphertext=decode('010203','hex');")
            assert run_migrator(path).returncode != 0
            assert sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1;") == "27"
            assert sql("SELECT count(*) FROM alfa_test_attempts;") == "1"
        link = seal("TEST", "link", b"https://example.test/fixture")
        sql(f"UPDATE alfa_test_attempts SET link_ciphertext=decode('{link}','hex');")
        migrated = run_migrator(path)
        assert migrated.returncode == 0, (migrated.stdout + migrated.stderr)[-1000:]
        assert sql("SELECT a.environment || '|' || c.environment || '|' || c.enabled FROM alfa_test_attempts a JOIN alfa_configuration c ON c.active_version=a.config_version;") == "TEST|TEST|true"
        assert sql("SELECT encode(ciphertext,'hex') FROM alfa_credentials_versions;") == valid
        assert sql("SELECT encode(link_ciphertext,'hex') FROM alfa_test_attempts;") == link
        assert sql("SELECT login || '|' || admin_enabled FROM accounts WHERE login='fixture';") == "fixture|true"
        assert sql("SELECT count(*) FROM spring_session WHERE principal_name='fixture';") == "1"
        assert sql("SELECT COALESCE(active_environment,'NONE') FROM alfa_gateway_selection;") == "NONE"
        app_start(path, unsafe_override=True)
        wait_for_app("Alfa production forbidden for this database")
        docker("stop", APPLICATION, check=False)
        app_start(path)
        wait_for_app("Started LastochkaApplicationKt")
        print("PASS: guarded V27->V28 preserves synthetic data; wrong target, invalid ciphertext and production override rejected")
finally:
    docker("rm", "-f", APPLICATION, DATABASE, check=False)
    docker("network", "rm", NETWORK, check=False)
