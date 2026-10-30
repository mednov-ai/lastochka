#!/usr/bin/env python3
"""Export the running backend contract in a reproducible form."""
import json
import os
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
url = os.environ.get('OPENAPI_URL', 'http://127.0.0.1:8080/lastochka/v3/api-docs')
with urlopen(url, timeout=15) as response:
    document = json.load(response)
document['servers'] = [{'url': os.environ.get('APP_BASE_PATH', '/lastochka')}]
(root / 'api' / 'openapi.json').write_text(json.dumps(document, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
print('Exported api/openapi.json')
