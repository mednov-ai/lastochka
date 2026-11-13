#!/usr/bin/env python3
"""Apply one protected, explicitly configured zone; never touches application data."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import stat
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
ZONES = {
    'test': ('test.lastochka-gym.ru', '18081', '18181'),
    'production': ('lastochka-gym.ru', '18080', '18180'),
}


def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout


def read_config(path, zone):
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o600:
        raise ValueError('Configuration must be a root-owned regular file with mode 0600')
    config = json.loads(path.read_text())
    if (not isinstance(config, dict) or set(config) not in ({'zone', 'mode'}, {'zone', 'mode', 'app_base'})
            or config.get('zone') != zone or config.get('mode') not in ('public', 'maintenance')
            or config.get('app_base', '/lastochka/') not in ('/', '/lastochka/')):
        raise ValueError('Invalid zone or mode configuration')
    return config


def render(zone, mode, root_app=False):
    _, app, gate = ZONES[zone]
    args = ['python3', str(HERE / 'render-gate-nginx.py'), '--environment', zone,
            '--app-port', app, '--gate-port', gate,
            '--certificate', '/etc/letsencrypt/live/lastochka-gym.ru/fullchain.pem',
            '--certificate-key', '/etc/letsencrypt/live/lastochka-gym.ru/privkey.pem',
            '--acme-root', '/var/www/lastochka-acme']
    if mode == 'public':
        args.append('--public')
    if root_app:
        args.append('--root-app')
    return run(*args).encode()


def sha(path):
    return hashlib.sha256(path.read_bytes()).digest()


def check_backup_directory(path):
    if path.is_symlink() or path.stat().st_uid != 0 or stat.S_IMODE(path.stat().st_mode) != 0o700:
        raise ValueError('Unsafe backup directory')


def verify_shadow(zone, content):
    """Test complete configuration without changing the live vhost on disk."""
    main = Path('/etc/nginx/nginx.conf').read_text()
    include = 'include /etc/nginx/sites-enabled/*;'
    if main.count(include) != 1:
        raise ValueError('Unexpected nginx configuration; no changes made')
    with tempfile.TemporaryDirectory(prefix='lastochka-nginx-check-') as tmp:
        folder = Path(tmp)
        sites = folder / 'sites'
        sites.mkdir()
        target = 'lastochka-' + zone
        found = False
        for item in Path('/etc/nginx/sites-enabled').iterdir():
            if item.name == target:
                (sites / item.name).write_bytes(content)
                found = True
            else:
                os.symlink(item.resolve(strict=True), sites / item.name)
        if not found:
            raise ValueError('Target vhost is not enabled')
        shadow = folder / 'nginx.conf'
        shadow.write_text(main.replace(include, f'include {sites}/*;'))
        run('nginx', '-t', '-c', str(shadow))


def replace(path, data, mode=0o644):
    fd, name = tempfile.mkstemp(prefix='.lastochka-vhost-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def request(host, path):
    # Connect to this server, while checking the real certificate and SNI.
    sock = socket.create_connection(('127.0.0.1', 443), timeout=5)
    wrapped = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
    conn = http.client.HTTPSConnection(host, timeout=5)
    conn.sock = wrapped
    try:
        conn.request('GET', path, headers={'Host': host})
        response = conn.getresponse()
        status, location = response.status, response.getheader('Location')
        response.read()
        return status, location
    finally:
        conn.close()


def gate_ready(zone, root_app=False):
    host, _, port = ZONES[zone]
    name = f'lastochka-{zone}-gate-1'
    details = json.loads(run('docker', 'inspect', name))[0]
    env = details['Config']['Env']
    if f'GATE_ZONE={zone}' not in env or 'GATE_RATE_STATE_FILE=/run/gate-state/rate.sqlite' not in env:
        raise ValueError('Expected PIN gate is not installed; existing vhost preserved')
    if root_app and 'GATE_APP_PATH=/' not in env:
        raise ValueError('Expected root-aware gate is not installed; existing vhost preserved')
    # Restart invalidates only gate sessions. Persistent rate limits survive.
    run('docker', 'restart', name)
    for _ in range(40):
        try:
            conn = http.client.HTTPConnection('127.0.0.1', int(port), timeout=2)
            conn.request('GET', '/__gate/verify', headers={'Host': host})
            response = conn.getresponse()
            status = response.status
            response.read()
            conn.close()
            if status == 401:
                return
        except OSError:
            pass
        time.sleep(.25)
    raise ValueError('PIN gate not ready; existing vhost preserved')


def apply(zone, mode, root_app=False):
    host, _, _ = ZONES[zone]
    path = Path('/etc/nginx/sites-available') / ('lastochka-' + zone)
    other = Path('/etc/nginx/sites-available') / ('lastochka-' + ('test' if zone == 'production' else 'production'))
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0:
        raise ValueError('Unexpected vhost ownership or type')
    original = path.read_bytes()
    old_hash, other_hash = sha(path), sha(other)
    candidate = render(zone, mode, root_app)
    verify_shadow(zone, candidate)
    if mode == 'maintenance':
        gate_ready(zone, root_app)
    if sha(path) != old_hash or sha(other) != other_hash:
        raise ValueError('Vhost changed concurrently; no changes made')
    backup_dir = Path('/etc/lastochka') / zone / 'nginx-backups'
    backup_dir.mkdir(mode=0o700, exist_ok=True)
    check_backup_directory(backup_dir)
    fd, backup = tempfile.mkstemp(prefix='vhost-', dir=backup_dir)
    with os.fdopen(fd, 'wb') as f:
        f.write(original)
        f.flush()
        os.fsync(f.fileno())
    try:
        replace(path, candidate, stat.S_IMODE(st.st_mode))
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        for _ in range(30):
            root = request(host, '/')
            site = request(host, '/api/v1/auth/me' if root_app else '/lastochka/')
            ok = ((root[0] == (200 if root_app else 308) and site[0] == 200) if mode == 'public' else (
                root[0] == 200 and site[0] == 302 and site[1] in ('/__gate/', f'https://{host}/__gate/'))
            )
            if ok:
                break
            time.sleep(.2)
        else:
            raise ValueError('HTTPS verification failed')
        if sha(other) != other_hash:
            raise ValueError('Other vhost changed during switch')
    except BaseException:
        replace(path, original, stat.S_IMODE(st.st_mode))
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        raise
    print(f'{zone}: {mode}; HTTPS verified; previous vhost saved at {backup}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zone', choices=ZONES, required=True)
    parser.add_argument('--approve-production', action='store_true', help='Only after explicit separate owner approval')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Root operator is required')
    if args.zone == 'production' and not args.approve_production:
        parser.error('Production requires separate owner approval')
    config = read_config(Path('/etc/lastochka') / args.zone / 'maintenance-mode.json', args.zone)
    apply(args.zone, config['mode'], config.get('app_base', '/lastochka/') == '/')


if __name__ == '__main__':
    main()
