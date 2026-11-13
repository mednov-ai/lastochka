#!/usr/bin/env python3
"""Deploy only the root-path test candidate; never touch a database or production."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
OLD = Path('/opt/lastochka/releases/isolated-v1')
MAINTENANCE = Path('/opt/lastochka/releases/maintenance-20261107')
CONFIG = Path('/etc/lastochka/test/maintenance-mode.json')
SITE = Path('/etc/nginx/sites-available/lastochka-test')
OTHER_SITE = Path('/etc/nginx/sites-available/lastochka-production')
ENV = '/etc/lastochka/test/compose.env'
GATE_ENV = '/etc/lastochka/test/maintenance.env'
ROOT_ENV = '/etc/lastochka/test/root-release.env'


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def inspect(name):
    return json.loads(run('docker', 'inspect', name))[0]


def wait_health(name):
    for _ in range(120):
        state = inspect(name)['State']
        if not state['Running']:
            raise RuntimeError(name + ' stopped unexpectedly')
        if state.get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError(name + ' did not become healthy')


def main():
    if os.geteuid() != 0:
        raise SystemExit('The test release requires the operator account')
    spec = importlib.util.spec_from_file_location('switch', ROOT / 'scripts/apply-maintenance-mode.py')
    switch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(switch)
    config = switch.read_config(CONFIG, 'test')
    if config != {'zone': 'test', 'mode': 'public'}:
        raise SystemExit('Test must still be in the verified legacy public configuration')
    original_config, original_site = CONFIG.read_bytes(), SITE.read_bytes()
    site_mode = SITE.stat().st_mode & 0o777
    other_hash = switch.sha(OTHER_SITE)
    db_before = inspect('lastochka-test-postgres-1')
    production_before = {name: inspect('lastochka-production-' + name + '-1')['Id']
                         for name in ('postgres', 'backend', 'frontend', 'proxy', 'gate')}
    if switch.request('test.lastochka-gym.ru', '/')[0] != 308:
        raise SystemExit('Unexpected initial test routing')
    base = ['docker', 'compose', '--env-file', ENV, '--env-file', GATE_ENV, '-p', 'lastochka-test']
    old = [*base, '-f', str(OLD / 'compose.isolated.yaml'), '-f', str(MAINTENANCE / 'compose.maintenance.yaml')]
    new = ['docker', 'compose', '--env-file', ENV, '--env-file', GATE_ENV, '--env-file', ROOT_ENV,
           '-p', 'lastochka-test', '-f', str(ROOT / 'compose.isolated.yaml'),
           '-f', str(ROOT / 'compose.maintenance.yaml'), '-f', str(ROOT / 'compose.root.yaml')]
    candidate = json.loads(run(*new, 'config', '--format', 'json'))
    services = candidate['services']
    if (services['backend']['environment']['SPRING_FLYWAY_ENABLED'] != 'false'
            or services['backend']['environment']['APP_BASE_PATH'] != ''
            or services['backend']['environment']['SERVER_SERVLET_SESSION_COOKIE_PATH'] != '/'
            or services['frontend']['environment']['APP_BASE_PATH'] != ''
            or services['gate']['environment']['GATE_APP_PATH'] != '/'):
        raise SystemExit('Candidate does not match the checked root deployment')
    mounted = next(m['Name'] for m in db_before['Mounts'] if m['Type'] == 'volume')
    if candidate['volumes']['postgres-data']['name'] != mounted:
        raise SystemExit('Test database volume identity mismatch')
    switch.verify_shadow('test', switch.render('test', 'public', True))
    backup_dir = Path('/etc/lastochka/test/nginx-backups')
    switch.check_backup_directory(backup_dir)
    fd, backup = tempfile.mkstemp(prefix='pre-root-vhost-', dir=backup_dir)
    with os.fdopen(fd, 'wb') as out:
        out.write(original_site)
        out.flush()
        os.fsync(out.fileno())
    changed = False
    try:
        for service in ('backend', 'frontend', 'proxy', 'gate'):
            changed = True
            run(*new, 'up', '-d', '--no-deps', '--no-build', service)
            if service in ('backend', 'frontend'):
                wait_health('lastochka-test-' + service + '-1')
        switch.replace(CONFIG, b'{"zone":"test","mode":"public","app_base":"/"}\n', 0o600)
        switch.apply('test', 'public', True)
        if switch.request('test.lastochka-gym.ru', '/')[0] != 200:
            raise RuntimeError('Root test website is not available')
        db_after = inspect('lastochka-test-postgres-1')
        if db_before['Id'] != db_after['Id'] or db_before['State']['StartedAt'] != db_after['State']['StartedAt']:
            raise RuntimeError('Test PostgreSQL unexpectedly changed')
        if switch.sha(OTHER_SITE) != other_hash:
            raise RuntimeError('Production vhost changed concurrently')
        for name, identity in production_before.items():
            if inspect('lastochka-production-' + name + '-1')['Id'] != identity:
                raise RuntimeError('Production container changed concurrently')
        print('Test root release applied; PostgreSQL and production containers preserved')
        print('Previous test vhost saved at', backup)
    except BaseException:
        if changed:
            print('Test release failed: restoring prior test services and vhost', flush=True)
            try:
                switch.replace(CONFIG, original_config, 0o600)
                for service in ('backend', 'frontend', 'proxy', 'gate'):
                    run(*old, 'up', '-d', '--no-deps', '--no-build', service)
                    if service in ('backend', 'frontend'):
                        wait_health('lastochka-test-' + service + '-1')
                switch.replace(SITE, original_site, site_mode)
                run('nginx', '-t')
                run('systemctl', 'reload', 'nginx')
                if switch.request('test.lastochka-gym.ru', '/')[0] != 308:
                    raise RuntimeError('Restored test route did not verify')
                print('Previous test release restored')
            except BaseException as rollback_error:
                print('Test rollback failed:', type(rollback_error).__name__, str(rollback_error), flush=True)
        raise


if __name__ == '__main__':
    main()
