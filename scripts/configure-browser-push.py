#!/usr/bin/env python3
"""Populate an operator-owned env file with a new VAPID pair without printing it."""
import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric import ec


def encoded(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: configure-browser-push.py ENV_FILE HTTPS_SUBJECT')
    path = Path(sys.argv[1])
    subject = sys.argv[2]
    parsed = urlsplit(subject)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise SystemExit('A valid HTTPS contact URL is required')
    if path.is_symlink() or not path.is_file():
        raise SystemExit('The private env file must be an existing regular file')
    lines = path.read_text().splitlines()
    names = ('PUSH_VAPID_PUBLIC_KEY', 'PUSH_VAPID_PRIVATE_KEY', 'PUSH_VAPID_SUBJECT')
    existing = {}
    for line in lines:
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            if key in names:
                if key in existing:
                    raise SystemExit('Duplicate push configuration; resolve it before continuing')
                existing[key] = value.strip()
    public = existing.get(names[0], '')
    private = existing.get(names[1], '')
    if public and private:
        print(json.dumps({'alreadyConfigured': True, 'changed': False}))
        return
    if public or private:
        raise SystemExit('Incomplete existing key pair; do not replace it automatically')
    key = ec.generate_private_key(ec.SECP256R1())
    numbers = key.private_numbers()
    point = numbers.public_numbers
    values = {
        names[0]: encoded(b'\x04' + point.x.to_bytes(32, 'big') + point.y.to_bytes(32, 'big')),
        names[1]: encoded(numbers.private_value.to_bytes(32, 'big')),
        names[2]: subject,
    }
    updated = []
    for line in lines:
        key_name = line.split('=', 1)[0] if '=' in line and not line.lstrip().startswith('#') else ''
        updated.append(f'{key_name}={values.pop(key_name)}' if key_name in values else line)
    updated.extend(f'{key_name}={value}' for key_name, value in values.items())
    fd, temporary = tempfile.mkstemp(prefix='.lastochka-push-', dir=path.parent, text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write('\n'.join(updated) + '\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    print(json.dumps({'alreadyConfigured': False, 'changed': True}))


if __name__ == '__main__':
    main()
