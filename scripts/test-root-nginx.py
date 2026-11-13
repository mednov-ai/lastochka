#!/usr/bin/env python3
"""Exercise root routing, the gate and legacy POST redirects in isolated containers."""
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import tempfile
import time
import urllib.parse

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def main():
    suffix = secrets.token_hex(6)
    network = 'lastochka-root-check-' + suffix
    names = {name: network + '-' + name for name in ('outer', 'inner', 'gate', 'frontend', 'backend')}
    created = []
    created_network = False
    with tempfile.TemporaryDirectory(prefix='lastochka-root-check-') as tmp:
        folder = Path(tmp)
        folder.chmod(0o755)
        pin, pepper, salt = b'0007', secrets.token_bytes(32), secrets.token_bytes(16)
        derived = hashlib.scrypt(hmac.digest(pepper, pin, 'sha256'), salt=salt, n=16384, r=8, p=1, dklen=64)
        for name, value in {'hash': f'{salt.hex()}:{derived.hex()}'.encode(), 'pepper': pepper, 'session': secrets.token_bytes(32)}.items():
            (folder / name).write_bytes(value)
            (folder / name).chmod(0o600)
        state = folder / 'state'
        state.mkdir(mode=0o700)
        run('python3', str(ROOT / 'scripts/init-maintenance-state.py'), '--path', str(state / 'rate.sqlite'), '--zone', 'test')
        run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(folder / 'tls.key'), '-out', str(folder / 'tls.crt'), '-days', '1', '-subj', '/CN=test.lastochka-gym.ru')
        base = ['python3', str(ROOT / 'scripts/render-gate-nginx.py'), '--environment', 'test', '--app-port', '8080', '--gate-port', '3001', '--certificate', '/fixtures/tls.crt', '--certificate-key', '/fixtures/tls.key', '--acme-root', '/fixtures', '--root-app']
        maintenance = run(*base)
        (folder / 'nginx.conf').write_text('events {}\nhttp {\n' + maintenance + '\n}\n')
        try:
            run('docker', 'network', 'create', network)
            created_network = True
            for name, port in (('frontend', 3000), ('backend', 8080)):
                code = ("require('http').createServer((q,s)=>{let b='';q.on('data',x=>b+=x);"
                        "q.on('end',()=>{s.setHeader('content-type','application/json');"
                        f"s.end(JSON.stringify({{service:'{name}',method:q.method,path:q.url,body:b}}))}})}}).listen({port},'0.0.0.0')")
                run('docker', 'run', '-d', '--name', names[name], '--network', network, '--network-alias', name, 'node:24-alpine', 'node', '-e', code)
                created.append(names[name])
            run('docker', 'run', '-d', '--name', names['outer'], '--network', network, '-p', '127.0.0.1::443', '-v', f'{folder}:/fixtures:ro', '-v', f'{folder}/nginx.conf:/etc/nginx/nginx.conf:ro', 'nginx:stable-alpine')
            created.append(names['outer'])
            run('docker', 'run', '-d', '--name', names['inner'], '--network', 'container:' + names['outer'], '-v', f'{ROOT}/infra/root-proxy.conf:/etc/nginx/nginx.conf:ro', 'nginx:stable-alpine')
            created.append(names['inner'])
            run('docker', 'run', '-d', '--name', names['gate'], '--user', '0', '--network', 'container:' + names['outer'], '-v', f'{folder}:/fixtures:ro', '-v', f'{state}:/rate:rw', '-e', 'GATE_ORIGIN=https://test.lastochka-gym.ru', '-e', 'GATE_ZONE=test', '-e', 'GATE_APP_PATH=/', '-e', 'GATE_PASSWORD_HASH_FILE=/fixtures/hash', '-e', 'GATE_SESSION_KEY_FILE=/fixtures/session', '-e', 'GATE_PEPPER_FILE=/fixtures/pepper', '-e', 'GATE_RATE_STATE_FILE=/rate/rate.sqlite', 'lastochka-site-gate:root-test')
            created.append(names['gate'])
            port = int(run('docker', 'port', names['outer'], '443/tcp').rsplit(':', 1)[1])

            def request(method, path, body=None, headers=None):
                conn = http.client.HTTPSConnection('127.0.0.1', port, timeout=5, context=ssl._create_unverified_context())
                conn.request(method, path, body, {'Host': 'test.lastochka-gym.ru', **(headers or {})})
                response = conn.getresponse()
                result = response.status, dict(response.getheaders()), response.read().decode()
                conn.close()
                return result

            for _ in range(30):
                try:
                    status, headers, html = request('GET', '/')
                    if status == 200:
                        break
                except OSError:
                    pass
                time.sleep(.2)
            assert status == 200 and 'Ведутся работы' in html
            for path in ('/api/v1/auth/me', '/lastochka/api/v1/admin/users', '/%6castochka/assets/a.js'):
                assert request('GET', path)[0] == 302
            assert request('POST', '/lastochka/api/v1/test', 'fixture')[0] == 302
            status, headers, html = request('GET', '/__gate/')
            csrf = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', html).group(1)
            cookie = headers['Set-Cookie'].split(';')[0]
            body = urllib.parse.urlencode({'csrf': csrf, 'pin': pin.decode()})
            status, headers, _ = request('POST', '/__gate/login', body, {'Origin': 'https://test.lastochka-gym.ru', 'Cookie': cookie, 'Content-Type': 'application/x-www-form-urlencoded'})
            assert status == 303 and headers['Location'] == '/'
            session = headers['Set-Cookie'].split(';')[0]
            assert json.loads(request('GET', '/', headers={'Cookie': session})[2])['service'] == 'frontend'
            status, headers, _ = request('POST', '/lastochka/api/v1/test?fixture=1', 'hello', {'Cookie': session})
            assert status == 308 and headers['Location'] == '/api/v1/test?fixture=1'
            status, _, body = request('POST', headers['Location'], 'hello', {'Cookie': session})
            assert status == 200 and json.loads(body) == {'service': 'backend', 'method': 'POST', 'path': '/api/v1/test?fixture=1', 'body': 'hello'}
            status, headers, _ = request('GET', '/lastochka/enquiry.data?fixture=1', headers={'Cookie': session})
            assert status == 204 and headers['X-Remix-Redirect'] == '/enquiry?fixture=1'
            assert headers['X-Remix-Reload-Document'] == 'true'
            status, headers, _ = request('POST', '/lastochka/enquiry.data', 'fixture', {'Cookie': session})
            assert status == 308 and headers['Location'] == '/enquiry.data'
            status, headers, _ = request('GET', '/lastochka/api/v1/example.data', headers={'Cookie': session})
            assert status == 308 and headers['Location'] == '/api/v1/example.data'
            run('docker', 'stop', '--time', '2', names['gate'])
            assert request('GET', '/', headers={'Cookie': session})[0] >= 500
            public = run(*base, '--public')
            (folder / 'nginx.conf').write_text('events {}\nhttp {\n' + public + '\n}\n')
            run('docker', 'exec', names['outer'], 'nginx', '-t')
            run('docker', 'exec', names['outer'], 'nginx', '-s', 'reload')
            for _ in range(30):
                status, _, body = request('GET', '/')
                if status == 200 and '"service":"frontend"' in body:
                    break
                time.sleep(.2)
            assert status == 200 and json.loads(body)['service'] == 'frontend'
            for _ in range(30):
                gate_status = request('GET', '/__gate/')[0]
                if gate_status == 404:
                    break
                time.sleep(.2)
            assert gate_status == 404, gate_status
            for _ in range(30):
                legacy_status = request('GET', '/lastochka/assets/a.js')[0]
                if legacy_status == 308:
                    break
                time.sleep(.2)
            assert legacy_status == 308, legacy_status
            print('Root nginx: gated/public modes, fail-closed and legacy POST redirect passed')
        finally:
            for name in reversed(created):
                subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if created_network:
                subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
