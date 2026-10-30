#!/usr/bin/env python3
"""Restore and compatible-binary rollback proof using only the dedicated local fixture DB."""
from pathlib import Path
import hashlib
import http.cookiejar
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
root=Path(__file__).resolve().parents[1]
out=root/'artifacts/prune-legacy'
container='lastochka-concept-postgres'
source='lastochka_concept'
restored='lastochka_concept_restore_v12_'+uuid.uuid4().hex[:8]
base='http://localhost:8098/lastochka'
jar=http.cookiejar.CookieJar()
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(url,body=None,key=None):
    headers={}
    if body is not None:
        token=json.load(client.open(url.rsplit('/api/',1)[0]+'/api/v1/auth/csrf'))['token']
        headers.update({'Content-Type':'application/json','X-CSRF-TOKEN':token})
        if key:headers['Idempotency-Key']=key
    req=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers)
    return json.load(client.open(req))
def fingerprint(database):
    sql="SELECT jsonb_build_object('enquiries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM enrollment_requests t),'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM payment_requests t),'queue',(SELECT jsonb_agg(to_jsonb(t) ORDER BY enquiry_id) FROM telegram_outbox t),'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM accounts t),'keys',(SELECT jsonb_agg(to_jsonb(t) ORDER BY credential_id) FROM user_credentials t),'schedule',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM studio_sessions t),'content',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM landing_content t))::text"
    data=subprocess.check_output(['docker','exec',container,'psql','-U','lastochka','-d',database,'-Atc',sql])
    return hashlib.sha256(data).hexdigest()
def start(filename,label):
    env=os.environ.copy()
    env.update(DATABASE_URL='jdbc:postgresql://127.0.0.1:55436/'+restored,DATABASE_USER='lastochka',DATABASE_PASSWORD='concept-local-only',PORT='8098',PUBLIC_APP_URL='http://localhost:5179/lastochka/',WEBAUTHN_ORIGIN='http://localhost:5179',WEBAUTHN_RP_ID='localhost',ADMIN_ACCESS_GENERATION='restored-concept-generation-20261023-0001',LASTOCHKA_ACCESS_GENERATION='restored-concept-generation-20261023-0001')
    log=(out/('restore-'+label+'.log')).open('wb')
    p=subprocess.Popen([str(root/'runtime-data/toolchains/jdk-25.0.4.1+1/Contents/Home/bin/java'),'-jar',str(root/filename),'--lastochka.workers.enabled=false'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    for _ in range(300):
        if p.poll() is not None:raise RuntimeError('Restore candidate exited: '+label)
        try:
            if urllib.request.urlopen(base+'/actuator/health/readiness',timeout=1).status==200:return p,log
        except Exception:pass
        time.sleep(.1)
    p.terminate();raise RuntimeError('Restore candidate was not ready')
def stop(p,log):
    p.terminate();p.wait(timeout=20);log.close()
# Establish a session that will be present in the backup with the old generation.
initial=call('http://localhost:8097/lastochka/api/v1/auth/password-stage',{'login':'fixture-admin','password':'Fixture-pass-123'})
assert initial['state']=='FULL'
original_hash=fingerprint(source)
with (out/'post-v12.dump').open('wb') as f:
    subprocess.run(['docker','exec',container,'pg_dump','-U','lastochka','-d',source,'-Fc'],stdout=f,check=True)
subprocess.run(['docker','exec',container,'createdb','-U','lastochka',restored],check=True,capture_output=True)
with (out/'post-v12.dump').open('rb') as f:
    subprocess.run(['docker','exec','-i',container,'pg_restore','-U','lastochka','-d',restored],stdin=f,check=True,capture_output=True)
assert fingerprint(restored)==original_hash
current=root/'runtime-data/admin-concept/backend.jar'
previous=root/'runtime-data/prune-legacy/compatible-candidate.jar'
p,log=start(current,'new')
try:
    assert call(base+'/api/v1/auth/me')['state']=='ANONYMOUS','Old restored session retained access'
    assert call(base+'/api/v1/auth/password-stage',{'login':'fixture-admin','password':'Fixture-pass-123'})['state']=='FULL'
    receipt=call(base+'/api/v1/enquiries',{'parentName':'Restore fixture','phone':'+79001234567','childName':'Fixture child','childAge':7},str(uuid.uuid4()))
    payment=call(base+'/api/v1/admin/payment-requests',{'amountMinor':32145,'purpose':'Restore fixture','recipientName':'Fixture parent','phone':'+79001234567'})
    assert receipt['number']>0 and payment['amountMinor']==32145
    expected=fingerprint(restored)
finally:stop(p,log)
p,log=start(previous,'compatible-previous')
try:
    assert call(base+'/api/v1/auth/me')['state']=='FULL'
    assert fingerprint(restored)==expected
    try:call(base+'/api/v1/bookings')
    except urllib.error.HTTPError as error:assert error.code==410
    else:raise AssertionError('Legacy booking access was restored')
finally:stop(p,log)
p,log=start(current,'new-again')
try:
    assert fingerprint(restored)==expected
    assert call(base+'/api/v1/admin/payment-requests/'+payment['id'])['amountMinor']==32145
finally:stop(p,log)
result={'restoredBusinessFingerprintMatches':True,'oldGenerationSessionRejected':True,'newPasswordLoginWorks':True,'newEnquiryAndDraftSurviveCompatibleRollback':True,'legacyBookingsRemainClosed':True,'postRollbackFingerprint':expected}
(out/'restore-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
