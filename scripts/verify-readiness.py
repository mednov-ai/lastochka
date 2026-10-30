#!/usr/bin/env python3
"""Briefly stop only the synthetic Lastochka preview database, restoring it in finally."""
import json,pathlib,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
CMD=['docker','compose','--project-name','lastochka-preview','--env-file',str(ROOT/'runtime-data/preview.env'),'-f',str(ROOT/'compose.preview.yaml')]
def compose(*args):return subprocess.run(CMD+list(args),check=True,capture_output=True,text=True)
def probes():
    code="Promise.all(['http://127.0.0.1:3000/healthz','http://127.0.0.1:3000/readyz','http://backend:8080/lastochka/actuator/health/liveness','http://backend:8080/lastochka/actuator/health/readiness'].map(async url=>{try{return(await fetch(url,{signal:AbortSignal.timeout(7000)})).status}catch{return 0}})).then(result=>console.log(JSON.stringify(result)))"
    return json.loads(compose('exec','-T','frontend','node','-e',code).stdout)
ids=compose('ps','-q','backend','frontend').stdout.split()
try:
    compose('stop','postgres')
    down=probes();assert down[0]==200 and down[1]==503 and down[2]==200 and down[3] in [503,0], down
finally: compose('start','postgres')
for attempt in range(12):
    try:
        restored=probes()
        if restored==[200,200,200,200]:break
    except Exception:pass
    time.sleep(1)
else:raise AssertionError('Probes did not recover')
assert compose('ps','-q','backend','frontend').stdout.split()==ids
(ROOT/'artifacts/readiness.json').write_text(json.dumps({'duringDatabaseOutage':down,'afterRecovery':restored,'containersRecreated':False},indent=2)+'\n')
print('Liveness/readiness separate; dependency outage recovered without app restart')
