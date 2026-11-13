#!/usr/bin/env python3
"""Exercise only a disposable, network-isolated synthetic PostgreSQL container."""
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = "lastochka-alfa-migration-" + uuid.uuid4().hex[:12]
IMAGE = "postgres:17.6-alpine"

def docker(*args: str, input_text: str | None = None, check: bool = True):
    return subprocess.run(["docker", *args], input=input_text, text=True, capture_output=True, check=check)

def sql(query: str, check: bool = True):
    return docker("exec", "-i", NAME, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", input_text=query, check=check)

try:
    docker("run", "-d", "--name", NAME, "--network", "none", "-e", "POSTGRES_PASSWORD=synthetic-only", IMAGE)
    for attempt in range(40):
        if docker("exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("Synthetic database failed to start")
    sql("CREATE TABLE accounts(id uuid PRIMARY KEY); CREATE TABLE payment_requests(id uuid PRIMARY KEY);")
    for migration in ("V20__alfa_test_attempts.sql", "V21__alfa_test_configuration.sql"):
        sql((ROOT / "backend/app/src/main/resources/db/migration" / migration).read_text())
    sql("""
      INSERT INTO accounts VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO payment_requests VALUES ('00000000-0000-4000-8000-000000000002');
      INSERT INTO alfa_credentials_versions VALUES ('00000000-0000-4000-8000-000000000003', decode('010203','hex'), now(), '00000000-0000-4000-8000-000000000001');
      UPDATE alfa_configuration SET active_version='00000000-0000-4000-8000-000000000003', enabled=true;
      INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,draft_version,amount_minor,purpose,operation_state)
      VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','fixture',1,100,'fixture','OPEN');
    """)
    migration = (ROOT / "backend/app/src/main/resources/repo/alfa/V28__alfa_gateway_environments.sql").read_text()
    # Structural SQL only: the Java Flyway migration authenticates legacy envelopes before this script.
    sql(migration)
    result = sql("SELECT c.environment, a.environment, encode(v.ciphertext,'hex'), c.enabled FROM alfa_configuration c JOIN alfa_credentials_versions v ON v.id=c.active_version JOIN alfa_test_attempts a ON a.config_version=v.id WHERE c.id=1;").stdout.strip()
    assert result == "TEST|TEST|010203|t", result
    assert sql("SELECT environment || '|' || enabled FROM alfa_configuration WHERE id=2;").stdout.strip() == "PRODUCTION|false"
    assert sql("SELECT COALESCE(active_environment,'NONE') FROM alfa_gateway_selection;").stdout.strip() == "NONE"
    mismatch = sql("UPDATE alfa_test_attempts SET environment='PRODUCTION' WHERE order_number='fixture';", check=False)
    assert mismatch.returncode != 0 and "identity is immutable" in mismatch.stderr
    mismatch = sql("UPDATE alfa_test_attempts SET amount_minor=200 WHERE order_number='fixture';", check=False)
    assert mismatch.returncode != 0 and "identity is immutable" in mismatch.stderr
    mismatch = sql("UPDATE alfa_credentials_versions SET environment='PRODUCTION' WHERE id='00000000-0000-4000-8000-000000000003';", check=False)
    assert mismatch.returncode != 0 and "identity is immutable" in mismatch.stderr
    mismatch = sql("UPDATE alfa_configuration SET active_version='00000000-0000-4000-8000-000000000003' WHERE id=2;", check=False)
    assert mismatch.returncode != 0 and "fk_alfa_config_active_environment" in mismatch.stderr
    sql("""
      INSERT INTO payment_requests VALUES ('00000000-0000-4000-8000-000000000004');
      INSERT INTO alfa_credentials_versions(id,ciphertext,created_at,created_by,environment)
        VALUES ('00000000-0000-4000-8000-000000000005',decode('010203','hex'),now(),'00000000-0000-4000-8000-000000000001','PRODUCTION');
      INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,draft_version,amount_minor,purpose,operation_state,environment)
        VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','fixture-prod',1,200,'fixture','OPEN','PRODUCTION');
    """)
    assert sql("SELECT order_number FROM alfa_test_attempts WHERE environment='TEST' ORDER BY order_number;").stdout.strip() == "fixture"
    assert sql("SELECT order_number FROM alfa_test_attempts WHERE environment='PRODUCTION' ORDER BY order_number;").stdout.strip() == "fixture-prod"
    sql("UPDATE alfa_test_attempts SET operation_state='DECLINED', bank_status='DECLINED', rejected_at=now()-interval '8 days';")
    source = (ROOT / "backend/payments/src/main/kotlin/ru/lastochka/payments/repo/PaymentRepository.kt").read_text()
    archive = re.search(r'@Query\(value = "(UPDATE alfa_test_attempts SET archived=true[^\"]*environment=:environment[^\"]*)"', source)
    assert archive is not None
    sql(archive.group(1).replace(':environment', "'TEST'").replace(':threshold', "now()-interval '7 days'"))
    assert sql("SELECT environment || '|' || archived FROM alfa_test_attempts ORDER BY environment;").stdout.strip() == "PRODUCTION|false\nTEST|true"
    # Execute the actual repository INSERT concurrently against one synthetic draft.
    query = re.search(r'@Query\(value = "(INSERT INTO alfa_test_attempts[^\"]*\x27PRODUCTION\x27[^\"]*)"', source)
    assert query is not None
    sql("INSERT INTO payment_requests VALUES ('00000000-0000-4000-8000-000000000008');")
    values = {
        "paymentId": "'00000000-0000-4000-8000-000000000008'",
        "configVersion": "'00000000-0000-4000-8000-000000000005'",
        "draftVersion": "1", "amountMinor": "200", "purpose": "'fixture'", "currency": "'643'",
    }
    processes = []
    for order in ("concurrent-a", "concurrent-b"):
        params = {**values, "orderNumber": f"'{order}'"}
        command = re.sub(r':([A-Za-z][A-Za-z0-9]*)', lambda m: params[m.group(1)], query.group(1))
        proc = subprocess.Popen(["docker", "exec", "-i", NAME, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        processes.append((proc, command))
    # Submit both before waiting, so the unique constraint arbitrates the competing writes.
    for proc, command in processes:
        proc.stdin.write("BEGIN; " + command + "; SELECT pg_sleep(0.3); COMMIT;\n")
        proc.stdin.close()
    outputs = []
    for proc, _ in processes:
        output = proc.stdout.read()
        errors = proc.stderr.read()
        assert proc.wait() == 0, errors
        outputs.append(output)
    assert sum("INSERT 0 1" in output for output in outputs) == 1, outputs
    assert sum("INSERT 0 0" in output for output in outputs) == 1, outputs
    assert sql("SELECT environment || '|' || currency || '|' || count(*) FROM alfa_test_attempts WHERE payment_id='00000000-0000-4000-8000-000000000008' GROUP BY environment,currency;").stdout.strip() == "PRODUCTION|643|1"
    status = re.search(r'@Query\(value = "(UPDATE alfa_test_attempts SET order_id=COALESCE\(order_id,:orderId\), operation_state=:state[^\"]*)"', source)
    assert status is not None
    params = {"id": values["paymentId"], "revision": "0", "orderId": "NULL", "state": "'CANCELLED'",
              "status": "'CANCELLED'", "checkedAt": "now()", "nextCheck": "now()"}
    sql(re.sub(r':([A-Za-z][A-Za-z0-9]*)', lambda m: params[m.group(1)], status.group(1)))
    assert sql("SELECT operation_state || '|' || archived FROM alfa_test_attempts WHERE payment_id='00000000-0000-4000-8000-000000000008';").stdout.strip() == "CANCELLED|true"
    print("PASS: V28 isolates TEST/PRODUCTION; concurrent repository inserts produce one production attempt; cryptographic preflight is tested separately")
finally:
    docker("rm", "-f", NAME, check=False)
