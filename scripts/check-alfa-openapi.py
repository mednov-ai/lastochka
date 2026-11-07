#!/usr/bin/env python3
"""Check the exported test-acquiring contract, never contacting a server."""
import json
from pathlib import Path

doc = json.loads((Path(__file__).resolve().parents[1] / 'api' / 'openapi.json').read_text())
paths = doc['paths']
callback = paths['/api/v1/public/alfa-test/callback']['get']
params = {p['name']: p for p in callback.get('parameters', [])}
assert set(params) == {'checksum', 'orderNumber', 'mdOrder', 'operation', 'status'}
assert all(p.get('in') == 'query' and p.get('required') is True for p in params.values())
assert set(params['status']['schema']['enum']) == {'0', '1'}
assert 'HMAC-SHA256' in callback.get('description', '')
assert not callback.get('security')
assert 'content' not in callback['responses']['404']

schemas = doc['components']['schemas']
candidate = schemas['AlfaCandidateRequest']
assert set(candidate['required']) == {'login', 'password', 'testConfirmed'}
for name in ('login', 'password', 'merchantLogin'):
    assert candidate['properties'][name].get('writeOnly') is True
assert 'keyId' in schemas['AlfaKeyRotationRequest']['required']
assert {'enabled', 'configured', 'candidatePresent'} <= set(schemas['AlfaConfigView']['required'])
assert 'expectedVersion' in schemas['PaymentCommand']['required']
listing = paths['/api/v1/admin/payment-requests']['get']
category = next(p for p in listing['parameters'] if p['name'] == 'category')
assert set(category['schema']['enum']) == {'ACTIVE', 'ARCHIVED'}
assert '20' in listing['description'] and '25' in listing['description']
assert set(listing['security'][0]) == {'session'}
for action in ('issue', 'refresh', 'cancel', 'archive', 'link'):
    post = paths[f'/api/v1/admin/payment-requests/{{id}}/{action}']['post']
    assert set(post['security'][0]) == {'session', 'csrf'}
    if action != 'link':
        assert post['requestBody']['required'] is True
for action in ('candidate', 'candidate/check', 'disable', 'rotate-key'):
    post = paths[f'/api/v1/admin/alfa-config/{action}']['post']
    assert set(post['security'][0]) == {'session', 'csrf'}
assert set(paths['/api/v1/admin/alfa-config']['get']['security'][0]) == {'session'}
print('PASS exported Alfa OpenAPI: callback, credentials, paging and CSRF')
