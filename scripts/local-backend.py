#!/usr/bin/env python3
"""Manage only this checkout's detached local backend process."""
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
runtime = root / 'runtime-data'
runtime.mkdir(exist_ok=True)
pid_file = runtime / 'backend.pid'
run_jar = runtime / 'backend-run.jar'
mode = sys.argv[1] if len(sys.argv) > 1 else 'start'
if mode not in ('start', 'stop', 'restart'):
    raise SystemExit('Use start, stop or restart')

def stop():
    if not pid_file.exists():
        return
    pid = int(pid_file.read_text())
    found = subprocess.run(['ps', '-p', str(pid), '-o', 'args='], capture_output=True, text=True)
    if found.returncode == 0:
        if str(run_jar) not in found.stdout:
            raise SystemExit('Refusing to stop a process outside this checkout')
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            # Detached children can remain zombies until reaped by their parent.
            state = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
            if state.returncode or state.stdout.strip().startswith('Z'):
                break
            time.sleep(.1)
        else:
            raise SystemExit('Backend did not stop gracefully; no forced termination performed')
    pid_file.unlink(missing_ok=True)

if mode in ('stop', 'restart'):
    stop()
if mode == 'stop':
    raise SystemExit(0)
if pid_file.exists():
    raise SystemExit('A managed backend exists; use restart')
portable = runtime / 'toolchains/jdk-25.0.4.1+1/Contents/Home/bin/java'
java = str(portable) if portable.exists() else str(Path(os.environ['JAVA_HOME']) / 'bin/java') if os.environ.get('JAVA_HOME') else 'java'
version = subprocess.run([java, '-version'], capture_output=True, text=True)
if 'version "25' not in version.stderr + version.stdout:
    raise SystemExit('Java 25 is required')
jar = root / 'backend/app/build/libs/app-0.1.0.jar'
if not jar.exists():
    raise SystemExit('Build :app:bootJar first')
shutil.copy2(jar, run_jar)
with (runtime / 'backend.log').open('wb') as log:
    process = subprocess.Popen([java, '-jar', str(run_jar)], cwd=root, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
pid_file.write_text(str(process.pid))
for _ in range(100):
    if process.poll() is not None:
        raise SystemExit('Backend exited; inspect runtime-data/backend.log')
    try:
        with urlopen('http://127.0.0.1:8080/lastochka/actuator/health', timeout=1) as response:
            if response.status == 200:
                print('Backend ready at http://127.0.0.1:8080/lastochka/')
                break
    except Exception:
        time.sleep(.1)
else:
    raise SystemExit('Backend readiness timeout; inspect local log')
