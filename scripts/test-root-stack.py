#!/usr/bin/env python3
"""Run the root-domain candidate on a disposable tmpfs PostgreSQL and private network."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def main():
    suffix = secrets.token_hex(8)
    network = 'lastochka-root-fixture-' + suffix
    names = {name: network + '-' + name for name in ('postgres', 'backend', 'frontend', 'old-frontend', 'proxy', 'old-image')}
    created = []
    created_network = False
    control = tempfile.TemporaryDirectory(prefix='lastochka-root-control-')
    control_path = Path(control.name)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://localhost:{port}'
    backend_env = [
        '-e', 'SPRING_PROFILES_ACTIVE=preview', '-e', 'DATABASE_URL=jdbc:postgresql://postgres:5432/lastochka',
        '-e', 'DATABASE_USER=postgres', '-e', 'DATABASE_PASSWORD=fixture-root-postgres',
        '-e', 'ADMIN_ACCESS_GENERATION=fixture-root-generation-123456789',
        '-e', 'LASTOCHKA_WORKERS_ENABLED=false', '-e', 'LASTOCHKA_ALFA_ENABLED=false',
        '-e', f'PUBLIC_APP_URL={origin}/', '-e', f'WEBAUTHN_ORIGIN={origin}', '-e', 'WEBAUTHN_RP_ID=localhost',
        '-e', 'COOKIE_SECURE=false', '-e', 'APP_BASE_PATH=', '-e', 'SERVER_SERVLET_SESSION_COOKIE_PATH=/',
        '-e', 'JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=35.0',
    ]
    try:
        run(['docker', 'network', 'create', network])
        created_network = True
        run(['docker', 'run', '-d', '--name', names['postgres'], '--network', network, '--network-alias', 'postgres',
             '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_DB=lastochka',
             '-e', 'POSTGRES_PASSWORD=fixture-root-postgres', 'postgres:17.6-alpine'])
        created.append(names['postgres'])
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', names['postgres'], 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Synthetic PostgreSQL did not start')
        # Flyway runs only against the freshly created tmpfs container above.
        run(['docker', 'run', '--rm', '--network', network, '--memory', '512m', *backend_env,
             '-e', 'SPRING_FLYWAY_ENABLED=true', '-e', 'LASTOCHKA_ADMIN_LOGIN=rootfixture',
             '-e', 'LASTOCHKA_ADMIN_NAME=Fixture', '-e', 'LASTOCHKA_ADMIN_PASSWORD=Fixture-root-password-2026',
             'lastochka-backend:root-candidate', '--lastochka.admin.create=true'], timeout=180)
        run(['docker', 'run', '-d', '--name', names['backend'], '--network', network, '--network-alias', 'backend',
             '--memory', '512m', *backend_env, '-e', 'SPRING_FLYWAY_ENABLED=false', 'lastochka-backend:root-candidate'])
        created.append(names['backend'])
        for _ in range(120):
            if subprocess.run(['docker', 'exec', names['backend'], 'bash', '/app/healthcheck.sh'], capture_output=True).returncode == 0:
                break
            if run(['docker', 'inspect', '-f', '{{.State.Running}}', names['backend']]) != 'true':
                raise RuntimeError('Synthetic root backend exited: ' + run(['docker', 'logs', '--tail', '30', names['backend']]))
            time.sleep(1)
        else:
            raise RuntimeError('Synthetic root backend did not become ready')
        run(['docker', 'run', '-d', '--name', names['frontend'], '--network', network, '--network-alias', 'frontend',
             '--memory', '160m', '--tmpfs', '/app/public-assets:rw,size=64m,uid=1000,gid=1000',
             '-e', 'APP_BASE_PATH=', '-e', 'BACKEND_INTERNAL_URL=http://backend:8080', '-e', f'PUBLIC_APP_URL={origin}/',
             'lastochka-frontend:root-candidate'])
        created.append(names['frontend'])
        # Copy only public assets from the previously built image into this fixture's tmpfs archive.
        run(['docker', 'create', '--name', names['old-image'], 'lastochka-frontend:isolated-v1'])
        created.append(names['old-image'])
        with tempfile.TemporaryDirectory(prefix='lastochka-root-assets-') as temp:
            run(['docker', 'cp', names['old-image'] + ':/app/build/client/assets', temp])
            assets = Path(temp) / 'assets'
            old_asset = next(iter(sorted(assets.glob('*.js')))).name
            run(['docker', 'exec', '-u', '0', names['frontend'], 'sh', '-c',
                 'mkdir -p /app/public-assets/assets && chown 1000:1000 /app/public-assets /app/public-assets/assets'])
            run(['docker', 'cp', str(assets) + '/.', names['frontend'] + ':/app/public-assets/assets/'])
        run(['docker', 'run', '-d', '--name', names['old-frontend'], '--network', network,
             '--network-alias', 'old-frontend', '--memory', '160m',
             '--tmpfs', '/app/public-assets:rw,size=64m,uid=1000,gid=1000',
             '-e', 'APP_BASE_PATH=/lastochka', '-e', 'BACKEND_INTERNAL_URL=http://backend:8080',
             '-e', f'PUBLIC_APP_URL={origin}/lastochka/', 'lastochka-frontend:isolated-v1'])
        created.append(names['old-frontend'])
        old_proxy = (ROOT / 'infra/preview-proxy.conf').read_text()
        old_proxy = old_proxy.replace('http://frontend:3000', 'http://old-frontend:3000')
        old_proxy = old_proxy.replace('proxy_pass http://backend:8080;',
                                      'rewrite ^/lastochka(/api/.*)$ $1 break; proxy_pass http://backend:8080;')
        proxy_conf = control_path / 'proxy.conf'
        proxy_conf.write_text(old_proxy)
        run(['docker', 'run', '-d', '--name', names['proxy'], '--network', network, '-p', f'127.0.0.1:{port}:8080',
             '-v', f'{proxy_conf}:/etc/nginx/nginx.conf:ro', 'nginx:stable-alpine'])
        created.append(names['proxy'])
        env = os.environ.copy()
        env['ROOT_FIXTURE_URL'] = origin
        env['ROOT_FIXTURE_OLD_ASSET'] = old_asset
        env['ROOT_FIXTURE_CONTROL'] = str(control_path)
        warm = subprocess.Popen(['node', 'tests/root-warm-tab.mjs'], cwd=ROOT / 'frontend', env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for _ in range(600):
                if (control_path / 'switch-request').exists():
                    break
                if warm.poll() is not None:
                    raise RuntimeError('Warm-tab setup failed: ' + warm.stdout.read()[-1500:])
                time.sleep(.1)
            else:
                raise RuntimeError('Warm-tab setup timed out')
            proxy_conf.write_text((ROOT / 'infra/root-proxy.conf').read_text())
            run(['docker', 'exec', names['proxy'], 'nginx', '-t'])
            run(['docker', 'exec', names['proxy'], 'nginx', '-s', 'reload'])
            (control_path / 'switch-done').write_text('done')
            output, _ = warm.communicate(timeout=60)
            if warm.returncode:
                raise RuntimeError('Warm-tab acceptance failed: ' + output[-1500:])
            print(output.strip())
        finally:
            if warm.poll() is None:
                warm.terminate()
                warm.wait(timeout=10)
        result = subprocess.run(['npx', 'playwright', 'test', '--config=playwright.root.config.ts'],
                                cwd=ROOT / 'frontend', env=env, text=True, timeout=150)
        if result.returncode:
            raise RuntimeError('Synthetic root browser acceptance failed')
        print('Disposable root stack: Flyway fixture, app, admin, WebAuthn and browser checks passed')
    finally:
        for name in reversed(created):
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if created_network:
            subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        control.cleanup()


if __name__ == '__main__':
    main()
