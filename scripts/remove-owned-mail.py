#!/usr/bin/env python3
"""Addressed retirement of this project's MailHog resources after verified backup."""
import subprocess,json,sys,tarfile,hashlib
from pathlib import Path
EXPECTED=['lastochka-preview-mailhog-public-1','lastochka-preview-mailhog-access-1','lastochka-preview-mailhog-1']
def validate_container(c):
 labels=c['Config'].get('Labels') or {}
 if labels.get('com.docker.compose.project')!='lastochka-preview' or labels.get('com.docker.compose.service') not in ['mailhog','mailhog-access','mailhog-public']:raise ValueError('Unowned mail resource')
def validate_consumers(ids,allowed):
 if set(ids)-set(allowed):raise ValueError('Mail resource has another consumer')
if sys.argv[1:]==['--self-test']:
 for action in [lambda:validate_container({'Config':{'Labels':{'com.docker.compose.project':'other'}}}),lambda:validate_consumers(['foreign'],['own'])]:
  try:action()
  except ValueError:pass
  else:raise AssertionError('Unsafe deletion accepted')
 print('Ownership/shared-consumer refusal checks passed');raise SystemExit
state=json.load(open('/opt/lastochka/shared/prune-0.9.0-state.json'))
assert state['backupVerified'] and state.get('acceptancePassed'), 'Backup and acceptance checkpoints required'
with tarfile.open(Path(state['backup'])/'maildir.tar.gz') as archive:
 assert {str(Path(m.name).relative_to('maildir')):hashlib.sha256(archive.extractfile(m).read()).hexdigest() for m in archive.getmembers() if m.isfile()}==state['mail']
run=lambda *a:subprocess.check_output(a,stderr=subprocess.PIPE)
containers=json.loads(run('docker','inspect',*EXPECTED));ids=[c['Id'] for c in containers]
for c in containers:validate_container(c)
volume=next(m['Name'] for c in containers for m in c['Mounts'] if m['Type']=='volume' and m['Destination']=='/maildir')
network=next(n for c in containers for n in c['NetworkSettings']['Networks'] if n=='lastochka-preview_mail')
v=json.loads(run('docker','volume','inspect',volume))[0]
assert v['Labels']['com.docker.compose.project']=='lastochka-preview'
validate_consumers(run('docker','ps','-aq','--no-trunc','--filter','volume='+volume).decode().split(),ids)
net=json.loads(run('docker','network','inspect',network))[0];validate_consumers(list(net.get('Containers',{})),ids)
# Remove only named owned containers, never the project or application/database volumes.
run('docker','stop','--time','15',*EXPECTED);run('docker','rm',*EXPECTED)
run('docker','volume','rm',volume);run('docker','network','rm',network)
removed_images=[]
for image in set(c['Image'] for c in containers):
 if not run('docker','ps','-aq','--filter','ancestor='+image).strip():
  # Docker may retain another tag/reference; no force removal.
  r=subprocess.run(['docker','image','rm',image],capture_output=True)
  if r.returncode==0:removed_images.append(image)
print(json.dumps({'removedContainers':EXPECTED,'removedVolume':volume,'removedNetwork':network,'removedUnusedImages':removed_images,'backup':state['backup']}))
