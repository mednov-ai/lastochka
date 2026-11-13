#!/usr/bin/env python3
"""Check isolation by rendering configuration only; never starts containers or a DB."""

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def render(zone: str, offset: int) -> dict:
    env = os.environ.copy()
    origin = "https://lastochka-gym.ru" if zone == "production" else "https://test.lastochka-gym.ru"
    env.update({
        "POSTGRES_IMAGE": "postgres:17.6-alpine",
        "BACKEND_IMAGE": "lastochka-backend:synthetic",
        "FRONTEND_IMAGE": "lastochka-frontend:synthetic",
        "NGINX_IMAGE": "nginx:stable-alpine",
        "GATE_IMAGE": "lastochka-gate:synthetic",
        "POSTGRES_PASSWORD_FILE": f"/synthetic/{zone}/postgres",
        "RUNTIME_DB_PASSWORD_FILE": f"/synthetic/{zone}/runtime",
        "GATE_HASH_FILE": f"/synthetic/{zone}/gate-hash",
        "GATE_SESSION_KEY_FILE": f"/synthetic/{zone}/gate-key",
        "ALFA_KEY_DIR": f"/synthetic/{zone}/alfa",
        "ALFA_KEY_ID": f"{zone}-key",
        "ALFA_PRODUCTION_ALLOWED": "false",
        "ALFA_DEPLOYMENT_ZONE": zone,
        # Same role name lives in independent PostgreSQL instances with different secrets.
        "DATABASE_RUNTIME_USER": "lastochka_runtime",
        "ADMIN_ACCESS_GENERATION": f"synthetic-{zone}-generation",
        "PUBLIC_APP_URL": f"{origin}/lastochka/",
        "WEBAUTHN_ORIGIN": origin,
        "WEBAUTHN_RP_ID": origin.removeprefix("https://"),
        "APP_LOOPBACK_PORT": str(18080 + offset),
        "GATE_LOOPBACK_PORT": str(18180 + offset),
        "LASTOCHKA_DB_VOLUME": f"lastochka-{zone}-postgres",
        "LASTOCHKA_ASSETS_VOLUME": f"lastochka-{zone}-assets",
    })
    result = subprocess.run(["docker", "compose", "--env-file", "/dev/null", "-p", f"lastochka-{zone}", "-f", str(ROOT / "compose.isolated.yaml"), "config", "--format", "json"], env=env, check=True, text=True, capture_output=True)
    return json.loads(result.stdout)


def main() -> None:
    production, test = render("production", 0), render("test", 1)
    assert production["volumes"]["postgres-data"]["external"] is True
    assert test["volumes"]["postgres-data"]["external"] is True
    assert production["volumes"]["postgres-data"]["name"] != test["volumes"]["postgres-data"]["name"]
    assert production["volumes"]["public-assets"]["external"] is True
    assert test["volumes"]["public-assets"]["external"] is True
    assert production["volumes"]["public-assets"]["name"] != test["volumes"]["public-assets"]["name"]
    assert production["networks"]["default"]["name"] != test["networks"]["default"]["name"]
    assert production["networks"]["edge"]["name"] != test["networks"]["edge"]["name"]
    assert production["networks"]["default"]["internal"] is True
    assert test["networks"]["default"]["internal"] is True
    for zone in (production, test):
        services = zone["services"]
        assert services["backend"]["environment"]["SPRING_FLYWAY_ENABLED"] == "false"
        assert services["backend"]["environment"]["LASTOCHKA_ALFA_ENABLED"] == "false"
        assert services["backend"]["environment"]["LASTOCHKA_ALFA_PRODUCTION_ALLOWED"] == "false"
        assert services["backend"]["environment"]["LASTOCHKA_WORKERS_ENABLED"] == "false"
        assert services["backend"]["environment"]["SPRING_CONFIG_IMPORT"] == "configtree:/run/runtime-config/"
        for name in ("postgres", "backend", "frontend"):
            assert not services[name].get("ports"), name
            assert set(services[name]["networks"]) == {"default"}, name
        for name in ("proxy", "gate"):
            assert all(port["host_ip"] == "127.0.0.1" for port in services[name]["ports"]), name
            assert set(services[name]["networks"]) == {"default", "edge"}, name
    assert production["services"]["backend"]["volumes"][0]["source"] != test["services"]["backend"]["volumes"][0]["source"]
    assert production["services"]["gate"]["environment"]["GATE_ORIGIN"] != test["services"]["gate"]["environment"]["GATE_ORIGIN"]
    assert production["services"]["proxy"]["ports"][0]["published"] != test["services"]["proxy"]["ports"][0]["published"]
    assert production["services"]["gate"]["ports"][0]["published"] != test["services"]["gate"]["ports"][0]["published"]
    print("Isolated Compose configuration: passed (no containers started)")


if __name__ == "__main__":
    main()
