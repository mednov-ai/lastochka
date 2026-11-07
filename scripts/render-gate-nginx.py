#!/usr/bin/env python3
"""Render a single Nginx vhost; values are restricted before substitution."""

import argparse
import re
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "infra/site-gate/nginx-site.conf.template"


def port(value: str) -> str:
    if not value.isdecimal() or not 1024 <= int(value) <= 65535:
        raise argparse.ArgumentTypeError("port must be in 1024..65535")
    return str(int(value))


def safe_path(value: str) -> str:
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", value) or ".." in value.split("/"):
        raise argparse.ArgumentTypeError("expected a safe absolute path")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", choices=("production", "test"), required=True)
    parser.add_argument("--app-port", type=port, required=True)
    parser.add_argument("--gate-port", type=port, required=True)
    parser.add_argument("--certificate", type=safe_path, required=True)
    parser.add_argument("--certificate-key", type=safe_path, required=True)
    parser.add_argument("--acme-root", type=safe_path, required=True)
    parser.add_argument("--public", action="store_true", help="Render an explicitly public site; production activation requires the owner's approval")
    args = parser.parse_args()
    if args.app_port == args.gate_port:
        parser.error("app and gate ports must differ")
    name = "lastochka-gym.ru" if args.environment == "production" else "test.lastochka-gym.ru"
    values = {
        "__HOSTNAME__": name,
        "__LIMIT_ZONE__": f"lastochka_{args.environment}",
        "__GATE_PORT__": args.gate_port,
        "__APP_PORT__": args.app_port,
        "__CERTIFICATE__": args.certificate,
        "__CERTIFICATE_KEY__": args.certificate_key,
        "__ACME_ROOT__": args.acme_root,
    }
    result = TEMPLATE.read_text(encoding="utf-8")
    if args.public:
        root = """    location = / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass http://127.0.0.1:__GATE_PORT__/__gate/;
    }"""
        protection = """        auth_request /_lastochka_gate_auth;
        error_page 401 = @access_required;"""
        if result.count(root) != 1 or result.count(protection) != 1:
            raise SystemExit("Gate template no longer matches the controlled public transition")
        result = result.replace(root, "    location = / { return 308 /lastochka/; }")
        result = result.replace(protection, "        auth_request off;")
    for key, value in values.items():
        result = result.replace(key, value)
    if re.search(r"__[A-Z_]+__", result):
        raise SystemExit("Unresolved Nginx template placeholder")
    print(result, end="")


if __name__ == "__main__":
    main()
