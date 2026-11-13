#!/usr/bin/env python3
"""Exercise the gate and Nginx in isolated, disposable Docker containers."""

import http.client
import hashlib
import hmac
import os
import re
import secrets
import socket
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
    nginx, gate, app, legacy = (f"lastochka-gate-check-{suffix}-{name}" for name in ("nginx", "gate", "app", "legacy"))
    created = []
    with tempfile.TemporaryDirectory(prefix="lastochka-gate-check-") as temp:
        directory = Path(temp)
        os.chmod(directory, 0o755)
        pin = b"0007"
        pepper, salt = secrets.token_bytes(32), secrets.token_bytes(16)
        keyed = hmac.digest(pepper, pin, "sha256")
        (directory / "hash").write_text(f"{salt.hex()}:{hashlib.scrypt(keyed, salt=salt, n=16384, r=8, p=1, dklen=64).hex()}")
        (directory / "pepper").write_bytes(pepper)
        (directory / "session").write_bytes(secrets.token_bytes(32))
        old_salt = secrets.token_bytes(16)
        old_password = b"synthetic-old-password"
        (directory / "old-hash").write_text(f"{old_salt.hex()}:{hashlib.scrypt(old_password, salt=old_salt, n=16384, r=8, p=1, dklen=64).hex()}")
        (directory / "old-session").write_bytes(secrets.token_bytes(32))
        state = directory / "state"
        state.mkdir(mode=0o700)
        run("python3", str(ROOT / "scripts/init-maintenance-state.py"), "--path", str(state / "rate.sqlite"), "--zone", "test")
        challenge = directory / ".well-known/acme-challenge"
        challenge.mkdir(parents=True)
        (challenge / "fixture").write_text("synthetic-acme")
        # Fixture container runs as root on Docker Desktop's UID-mapped bind mount.
        for item in ("hash", "session", "pepper", "old-hash", "old-session"):
            (directory / item).chmod(0o600)
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(directory / "tls.key"), "-out", str(directory / "tls.crt"), "-days", "1", "-subj", "/CN=test.lastochka-gym.ru")
        rendered = run("python3", str(ROOT / "scripts/render-gate-nginx.py"), "--environment", "test", "--app-port", "3002", "--gate-port", "3001", "--certificate", "/fixtures/tls.crt", "--certificate-key", "/fixtures/tls.key", "--acme-root", "/fixtures")
        (directory / "nginx.conf").write_text("events {}\nhttp {\n" + rendered + "\n}\n")
        try:
            run("docker", "run", "-d", "--name", nginx, "-p", "127.0.0.1::443", "-p", "127.0.0.1::80", "-v", f"{directory}:/fixtures:ro", "-v", f"{directory}/nginx.conf:/etc/nginx/nginx.conf:ro", "nginx:stable-alpine")
            created.append(nginx)
            code = "require('http').createServer((q,s)=>s.end('SYNTHETIC_APPLICATION_CONTENT')).listen(3002,'127.0.0.1')"
            run("docker", "run", "-d", "--name", app, "--network", f"container:{nginx}", "node:24-alpine", "node", "-e", code)
            created.append(app)
            port = int(run("docker", "port", nginx, "443/tcp").rsplit(":", 1)[1])
            http_port = int(run("docker", "port", nginx, "80/tcp").rsplit(":", 1)[1])

            def handshake(version):
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
                context.minimum_version = version
                context.maximum_version = version
                with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
                    with context.wrap_socket(sock, server_hostname="test.lastochka-gym.ru") as tls:
                        return tls.version()

            assert handshake(ssl.TLSVersion.TLSv1_2) == "TLSv1.2"
            try:
                handshake(ssl.TLSVersion.TLSv1_3)
            except ssl.SSLError:
                pass
            else:
                raise AssertionError("TLS 1.3 must remain disabled")

            def check_acme():
                connection = http.client.HTTPConnection("127.0.0.1", http_port, timeout=10)
                connection.request("GET", "/.well-known/acme-challenge/fixture", headers={"Host": "test.lastochka-gym.ru"})
                response = connection.getresponse()
                assert response.status == 200 and response.read() == b"synthetic-acme"
                connection.close()

            def request(method, path, body=None, headers=None):
                connection = http.client.HTTPSConnection("127.0.0.1", port, timeout=10, context=ssl._create_unverified_context())
                connection.request(method, path, body=body, headers={"Host": "test.lastochka-gym.ru", **(headers or {})})
                response = connection.getresponse()
                result = response.status, dict(response.getheaders()), response.read().decode("utf-8")
                connection.close()
                return result

            run("docker", "run", "-d", "--name", legacy, "--user", "0", "--network", f"container:{nginx}", "-v", f"{directory}:/fixtures:ro", "-e", "GATE_ORIGIN=https://test.lastochka-gym.ru", "-e", "GATE_PASSWORD_HASH_FILE=/fixtures/old-hash", "-e", "GATE_SESSION_KEY_FILE=/fixtures/old-session", "lastochka-site-gate:epoch-a")
            created.append(legacy)
            def check_old_gate():
                for _ in range(30):
                    try:
                        status, headers, html = request("GET", "/__gate/")
                        if status == 200:
                            break
                    except OSError:
                        pass
                    time.sleep(.2)
                assert status == 200 and request("GET", "/lastochka/")[0] == 302
                csrf = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', html).group(1)
                cookie = headers["Set-Cookie"].split(";", 1)[0]
                body = urllib.parse.urlencode({"csrf": csrf, "password": old_password.decode()})
                status, headers, _ = request("POST", "/__gate/login", body, {"Origin": "https://test.lastochka-gym.ru", "Cookie": cookie, "Content-Type": "application/x-www-form-urlencoded"})
                assert status == 303
                session = headers["Set-Cookie"].split(";", 1)[0]
                assert request("GET", "/lastochka/", headers={"Cookie": session})[0] == 200
            check_old_gate()
            run("docker", "stop", "--time", "2", legacy)
            # Docker Desktop maps the host fixture to root; the real image runs as UID 10001.
            run("docker", "run", "-d", "--name", gate, "--user", "0", "--network", f"container:{nginx}", "-v", f"{directory}:/fixtures:ro", "-v", f"{state}:/rate:rw", "-e", "GATE_ORIGIN=https://test.lastochka-gym.ru", "-e", "GATE_ZONE=test", "-e", "GATE_PASSWORD_HASH_FILE=/fixtures/hash", "-e", "GATE_SESSION_KEY_FILE=/fixtures/session", "-e", "GATE_PEPPER_FILE=/fixtures/pepper", "-e", "GATE_RATE_STATE_FILE=/rate/rate.sqlite", "lastochka-site-gate:local-test")
            created.append(gate)
            for _ in range(30):
                try:
                    if request("GET", "/__gate/")[0] == 200:
                        break
                except (OSError, http.client.HTTPException):
                    pass
                time.sleep(0.2)
            else:
                raise AssertionError("Gate did not start")
            check_acme()

            for path in ("/lastochka/", "/lastochka/api/v1/admin", "/lastochka/static/example.js", "/%6castochka/api/v1/admin"):
                status, _, body = request("GET", path)
                assert status == 302 and "SYNTHETIC_APPLICATION_CONTENT" not in body, (path, status)
            assert request("GET", "/__gate/verify")[0] == 404
            assert request("GET", "/_lastochka_gate_auth")[0] == 404
            status, headers, html = request("GET", "/__gate/")
            assert status == 200
            assert "0007" not in html
            csrf = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', html).group(1)
            csrf_cookie = headers["Set-Cookie"].split(";", 1)[0]
            body = urllib.parse.urlencode({"csrf": csrf, "pin": "0007"})
            status, headers, _ = request("POST", "/__gate/login", body, {"Origin": "https://test.lastochka-gym.ru", "Cookie": csrf_cookie, "Content-Type": "application/x-www-form-urlencoded"})
            assert status == 303
            session = headers["Set-Cookie"].split(";", 1)[0]
            status, _, body = request("GET", "/lastochka/api/v1/example", headers={"Cookie": session})
            assert status == 200 and body == "SYNTHETIC_APPLICATION_CONTENT"
            for container in (nginx, gate):
                logs = subprocess.run(["docker", "logs", container], check=True, capture_output=True, text=True)
                assert "pin=0007" not in (logs.stdout + logs.stderr)
            run("docker", "stop", "--time", "2", gate)
            check_acme()
            status, _, body = request("GET", "/lastochka/api/v1/example", headers={"Cookie": session})
            assert status >= 500 and "SYNTHETIC_APPLICATION_CONTENT" not in body
            run("docker", "start", legacy)
            check_old_gate()
            run("docker", "stop", "--time", "2", legacy)
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
            assert request("GET", "/__gate/")[0] == 404
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
