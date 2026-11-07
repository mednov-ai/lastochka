#!/usr/bin/env python3
"""Exercise the gate and Nginx in isolated, disposable Docker containers."""

import http.client
import os
import re
import secrets
import ssl
import subprocess
import tempfile
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def main():
    suffix = secrets.token_hex(6)
    nginx, gate, app = (f"lastochka-gate-check-{suffix}-{name}" for name in ("nginx", "gate", "app"))
    created = []
    with tempfile.TemporaryDirectory(prefix="lastochka-gate-check-") as temp:
        directory = Path(temp)
        os.chmod(directory, 0o755)
        (directory / "password").write_text("synthetic-test-password")
        run("python3", str(ROOT / "scripts/create-gate-secrets.py"), "--password-file", str(directory / "password"), "--hash-file", str(directory / "hash"), "--key-file", str(directory / "session"))
        # These are disposable fixture secrets; real secrets must remain 0600 and owned by the gate UID.
        (directory / "hash").chmod(0o644)
        (directory / "session").chmod(0o644)
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(directory / "tls.key"), "-out", str(directory / "tls.crt"), "-days", "1", "-subj", "/CN=test.lastochka-gym.ru")
        rendered = run("python3", str(ROOT / "scripts/render-gate-nginx.py"), "--environment", "test", "--app-port", "3002", "--gate-port", "3001", "--certificate", "/fixtures/tls.crt", "--certificate-key", "/fixtures/tls.key", "--acme-root", "/fixtures")
        (directory / "nginx.conf").write_text("events {}\nhttp {\n" + rendered + "\n}\n")
        try:
            run("docker", "run", "-d", "--name", nginx, "-p", "127.0.0.1::443", "-v", f"{directory}:/fixtures:ro", "-v", f"{directory}/nginx.conf:/etc/nginx/nginx.conf:ro", "nginx:stable-alpine")
            created.append(nginx)
            run("docker", "run", "-d", "--name", gate, "--network", f"container:{nginx}", "-v", f"{directory}:/fixtures:ro", "-e", "GATE_ORIGIN=https://test.lastochka-gym.ru", "-e", "GATE_PASSWORD_HASH_FILE=/fixtures/hash", "-e", "GATE_SESSION_KEY_FILE=/fixtures/session", "lastochka-site-gate:local-test")
            created.append(gate)
            code = "require('http').createServer((q,s)=>s.end('SYNTHETIC_APPLICATION_CONTENT')).listen(3002,'127.0.0.1')"
            run("docker", "run", "-d", "--name", app, "--network", f"container:{nginx}", "node:24-alpine", "node", "-e", code)
            created.append(app)
            port = int(run("docker", "port", nginx, "443/tcp").rsplit(":", 1)[1])

            def request(method, path, body=None, headers=None):
                connection = http.client.HTTPSConnection("127.0.0.1", port, timeout=10, context=ssl._create_unverified_context())
                connection.request(method, path, body=body, headers={"Host": "test.lastochka-gym.ru", **(headers or {})})
                response = connection.getresponse()
                result = response.status, dict(response.getheaders()), response.read().decode("utf-8")
                connection.close()
                return result

            for _ in range(30):
                try:
                    if request("GET", "/__gate/")[0] == 200:
                        break
                except (OSError, http.client.HTTPException):
                    pass
                time.sleep(0.2)
            else:
                raise AssertionError("Gate did not start")

            for path in ("/lastochka/", "/lastochka/api/v1/admin", "/lastochka/static/example.js", "/%6castochka/api/v1/admin"):
                status, _, body = request("GET", path)
                assert status == 302 and "SYNTHETIC_APPLICATION_CONTENT" not in body, (path, status)
            assert request("GET", "/__gate/verify")[0] == 404
            assert request("GET", "/_lastochka_gate_auth")[0] == 404
            status, headers, html = request("GET", "/__gate/")
            assert status == 200
            assert "synthetic-test-password" not in html
            csrf = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', html).group(1)
            csrf_cookie = headers["Set-Cookie"].split(";", 1)[0]
            body = urllib.parse.urlencode({"csrf": csrf, "password": "synthetic-test-password"})
            status, headers, _ = request("POST", "/__gate/login", body, {"Origin": "https://test.lastochka-gym.ru", "Cookie": csrf_cookie, "Content-Type": "application/x-www-form-urlencoded"})
            assert status == 303
            session = headers["Set-Cookie"].split(";", 1)[0]
            status, _, body = request("GET", "/lastochka/api/v1/example", headers={"Cookie": session})
            assert status == 200 and body == "SYNTHETIC_APPLICATION_CONTENT"
            for container in (nginx, gate):
                logs = subprocess.run(["docker", "logs", container], check=True, capture_output=True, text=True)
                assert "synthetic-test-password" not in (logs.stdout + logs.stderr)
            run("docker", "stop", "--time", "2", gate)
            status, _, body = request("GET", "/lastochka/api/v1/example", headers={"Cookie": session})
            assert status >= 500 and "SYNTHETIC_APPLICATION_CONTENT" not in body
            public = run("python3", str(ROOT / "scripts/render-gate-nginx.py"), "--environment", "test", "--app-port", "3002", "--gate-port", "3001", "--certificate", "/fixtures/tls.crt", "--certificate-key", "/fixtures/tls.key", "--acme-root", "/fixtures", "--public")
            (directory / "nginx.conf").write_text("events {}\nhttp {\n" + public + "\n}\n")
            run("docker", "exec", nginx, "nginx", "-t")
            run("docker", "exec", nginx, "nginx", "-s", "reload")
            for _ in range(30):
                status, _, body = request("GET", "/lastochka/api/v1/example")
                if status == 200:
                    break
                time.sleep(0.2)
            assert status == 200 and body == "SYNTHETIC_APPLICATION_CONTENT"
            assert request("GET", "/")[0] == 308
            (directory / "nginx.conf").write_text("events {}\nhttp {\n" + rendered + "\n}\n")
            run("docker", "exec", nginx, "nginx", "-t")
            run("docker", "exec", nginx, "nginx", "-s", "reload")
            for _ in range(30):
                status, _, body = request("GET", "/lastochka/api/v1/example")
                if status >= 500:
                    break
                time.sleep(0.2)
            assert status >= 500 and "SYNTHETIC_APPLICATION_CONTENT" not in body
            print("Nginx gate integration: passed (isolated fixtures)")
        finally:
            for name in reversed(created):
                subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main()
