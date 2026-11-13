#!/usr/bin/env python3
"""Apply the separately approved root-path production candidate, with gate rollback."""
import argparse
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROOT = Path(__file__).resolve().parent.parent
OLD = Path('/opt/lastochka/releases/isolated-v1')
MAINTENANCE = Path('/opt/lastochka/releases/maintenance-20261107')
CONFIG = Path('/etc/lastochka/production/maintenance-mode.json')
SITE = Path('/etc/nginx/sites-available/lastochka-production')
OTHER_SITE = Path('/etc/nginx/sites-available/lastochka-test')
ENV = '/etc/lastochka/production/compose.env'
GATE_ENV = '/etc/lastochka/production/maintenance.env'
ROOT_ENV = '/etc/lastochka/production/root-release.env'
HOST = 'lastochka-gym.ru'


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


def request(method, path, body=None, headers=None):
    sock = socket.create_connection(('127.0.0.1', 443), timeout=10)
    wrapped = ssl.create_default_context().wrap_socket(sock, server_hostname=HOST)
    conn = http.client.HTTPSConnection(HOST, timeout=10)
    conn.sock = wrapped
    try:
        conn.request(method, path, body, {'Host': HOST, **(headers or {})})
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read().decode()
    finally:
        conn.close()


def verify_pin(pin):
    status, headers, html = request('GET', '/__gate/')
    match = re.search(r'name="csrf" value="([A-Za-z0-9_-]+)"', html)
    if status != 200 or not match:
        raise RuntimeError('Production gate form did not load')
    cookie = headers['Set-Cookie'].split(';', 1)[0]
    body = urllib.parse.urlencode({'csrf': match.group(1), 'pin': pin})
    status, headers, _ = request('POST', '/__gate/login', body, {
        'Origin': 'https://' + HOST, 'Cookie': cookie, 'Content-Type': 'application/x-www-form-urlencoded',
    })
    if status != 303 or headers.get('Location') != '/':
        raise RuntimeError('Production PIN check failed')
    session = headers['Set-Cookie'].split(';', 1)[0]
    if request('GET', '/', headers={'Cookie': session})[0] != 200:
        raise RuntimeError('Production application did not open after PIN')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approve-production', action='store_true', help='Use only after a separate explicit owner approval')
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.approve_production:
        raise SystemExit('Root operator and separate explicit owner approval are required')
    pin = sys.stdin.read()
    if not re.fullmatch(r'[0-9]{4}', pin):
        raise SystemExit('Expected the four-digit production PIN on protected standard input')
    spec = importlib.util.spec_from_file_location('switch', ROOT / 'scripts/apply-maintenance-mode.py')
    switch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(switch)
    if switch.read_config(CONFIG, 'production') != {'zone': 'production', 'mode': 'maintenance'}:
        raise SystemExit('Production must still use the verified legacy maintenance configuration')
    original_config, original_site = CONFIG.read_bytes(), SITE.read_bytes()
    site_mode = SITE.stat().st_mode & 0o777
    other_hash = switch.sha(OTHER_SITE)
    db_before = inspect('lastochka-production-postgres-1')
    test_before = {name: inspect('lastochka-test-' + name + '-1')['Id']
                   for name in ('postgres', 'backend', 'frontend', 'proxy', 'gate')}
    if request('GET', '/')[0] != 200 or request('GET', '/lastochka/')[0] != 302:
        raise SystemExit('Unexpected initial production protection')
    if switch.request('test.lastochka-gym.ru', '/')[0] != 200:
        raise SystemExit('Test root is not healthy')
    base = ['docker', 'compose', '--env-file', ENV, '--env-file', GATE_ENV, '-p', 'lastochka-production']
    old = [*base, '-f', str(OLD / 'compose.isolated.yaml'), '-f', str(MAINTENANCE / 'compose.maintenance.yaml')]
    new = ['docker', 'compose', '--env-file', ENV, '--env-file', GATE_ENV, '--env-file', ROOT_ENV,
           '-p', 'lastochka-production', '-f', str(ROOT / 'compose.isolated.yaml'),
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
        raise SystemExit('Production database volume identity mismatch')
    rendered = switch.render('production', 'maintenance', True)
    if b'ssl_protocols TLSv1.2;' not in rendered or b'TLSv1.3' in rendered:
        raise SystemExit('Candidate does not enforce TLS 1.2')
    switch.verify_shadow('production', rendered)
    backup_dir = Path('/etc/lastochka/production/nginx-backups')
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
                wait_health('lastochka-production-' + service + '-1')
        switch.replace(CONFIG, b'{"zone":"production","mode":"maintenance","app_base":"/"}\n', 0o600)
        switch.apply('production', 'maintenance', True)
        for path in ('/api/v1/auth/me', '/lastochka/api/v1/auth/me', '/%6castochka/enquiry'):
            if request('GET', path)[0] != 302:
                raise RuntimeError('A protected path did not require the gate')
        verify_pin(pin)
        db_after = inspect('lastochka-production-postgres-1')
        if db_before['Id'] != db_after['Id'] or db_before['State']['StartedAt'] != db_after['State']['StartedAt']:
            raise RuntimeError('Production PostgreSQL unexpectedly changed')
        if switch.sha(OTHER_SITE) != other_hash or switch.request('test.lastochka-gym.ru', '/')[0] != 200:
            raise RuntimeError('Test root changed unexpectedly')
        for name, identity in test_before.items():
            if inspect('lastochka-test-' + name + '-1')['Id'] != identity:
                raise RuntimeError('Test container changed concurrently')
        print('Production root release verified with PIN; databases and test containers preserved')
        print('Previous protected production vhost saved at', backup)
    except BaseException:
        if changed:
            print('Production release failed: restoring prior protected gate and services', flush=True)
            try:
                switch.replace(CONFIG, original_config, 0o600)
                for service in ('backend', 'frontend', 'proxy', 'gate'):
                    run(*old, 'up', '-d', '--no-deps', '--no-build', service)
                    if service in ('backend', 'frontend'):
                        wait_health('lastochka-production-' + service + '-1')
                switch.replace(SITE, original_site, site_mode)
                run('nginx', '-t')
                run('systemctl', 'reload', 'nginx')
                if request('GET', '/lastochka/')[0] != 302:
                    raise RuntimeError('Restored production protection did not verify')
                print('Previous protected production release restored')
            except BaseException as rollback_error:
                print('Production rollback failed:', type(rollback_error).__name__, str(rollback_error), flush=True)
        raise


if __name__ == '__main__':
    main()
