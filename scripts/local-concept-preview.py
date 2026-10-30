#!/usr/bin/env python3
"""Restart only the isolated acceptance backend, never the normal local/server database."""
from pathlib import Path
import os
import signal
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen
root=Path(__file__).resolve().parents[1]
runtime=root/'runtime-data/admin-concept'
runtime.mkdir(parents=True,exist_ok=True)
marker='runtime-data/admin-concept/backend.jar'
if sys.argv[1:] != ['restart-backend']:
    raise SystemExit('Use restart-backend')
found=subprocess.run(['lsof','-nP','-iTCP:8097','-sTCP:LISTEN','-t'],capture_output=True,text=True)
for value in found.stdout.split():
    args=subprocess.check_output(['ps','-p',value,'-o','args='],text=True)
    if marker not in args:
        raise SystemExit('Refusing to stop an unrelated process')
    os.kill(int(value),signal.SIGTERM)
    for _ in range(100):
        if subprocess.run(['lsof','-nP','-iTCP:8097','-sTCP:LISTEN','-t'],capture_output=True).returncode:
            break
        time.sleep(.1)
    else: raise SystemExit('Acceptance backend did not stop')
shutil.copyfile(root/'backend/app/build/libs/app-0.1.0.jar',runtime/'backend.jar')
env=os.environ.copy()
env.update(DATABASE_URL='jdbc:postgresql://127.0.0.1:55436/lastochka_concept',DATABASE_USER='lastochka',DATABASE_PASSWORD='concept-local-only',PORT='8097',PUBLIC_APP_URL='http://localhost:5179/lastochka/',WEBAUTHN_ORIGIN='http://localhost:5179',WEBAUTHN_RP_ID='localhost')
with (root/'artifacts/admin-concept/backend.log').open('wb') as log:
    process=subprocess.Popen([str(root/'runtime-data/toolchains/jdk-25.0.4.1+1/Contents/Home/bin/java'),'-jar',str(runtime/'backend.jar'),'--lastochka.workers.enabled=false'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
(runtime/'backend.pid').write_text(str(process.pid))
for _ in range(300):
    if process.poll() is not None:raise SystemExit('Acceptance backend exited')
    try:
        with urlopen('http://localhost:8097/lastochka/actuator/health/readiness',timeout=1) as response:
            if response.status==200:break
    except Exception:pass
    time.sleep(.1)
else:raise SystemExit('Acceptance backend is not ready')
print('Isolated acceptance backend restarted')
