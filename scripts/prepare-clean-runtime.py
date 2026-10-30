#!/usr/bin/env python3
"""Flatten an already accepted local runtime, excluding old application payloads."""
import subprocess,json,tarfile,sys,tempfile
from pathlib import Path
kind,source,target=sys.argv[1:]
assert kind in ['backend','frontend']
config=json.loads(subprocess.check_output(['docker','image','inspect',source]))[0]['Config']
container=subprocess.check_output(['docker','create',source],text=True).strip()
try:
 with tempfile.TemporaryDirectory() as d:
  original=Path(d)/'original.tar';clean=Path(d)/'runtime.tar'
  subprocess.run(['docker','export','-o',str(original),container],check=True)
  with tarfile.open(original) as src,tarfile.open(clean,'w') as dst:
   for member in src:
    name=member.name.lstrip('./')
    if name=='app/app.jar' or name=='app/healthcheck.sh' or name.startswith('app/build/') or name=='app/build':continue
    dst.addfile(member,src.extractfile(member) if member.isfile() else None)
  args=['docker','import','--platform','linux/amd64']
  for e in config.get('Env') or []:args+=['--change','ENV '+e]
  for key in ['Entrypoint','Cmd']:
   if config.get(key):args+=['--change',key.upper()+' '+json.dumps(config[key])]
  subprocess.run([*args,str(clean),target],check=True)
finally:subprocess.run(['docker','rm',container],check=True,stdout=subprocess.DEVNULL)
