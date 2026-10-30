from pathlib import Path
import os, subprocess, socket, time, json, urllib.request, urllib.error, http.cookiejar, uuid, signal
root=Path(__file__).resolve().parents[1]; temp=root/'runtime-data/jpa-compatibility'; temp.mkdir(exist_ok=True)
old=root/'runtime-data/jpa-baseline-3f00640/backend/app/build/libs/app-0.1.0.jar'; new=root/'backend/app/build/libs/app-0.1.0.jar'
java=root/'runtime-data/toolchains/jdk-25.0.4.1+1/Contents/Home/bin/java'
node=root/'runtime-data/toolchains/node-v24.22.0-darwin-arm64/bin/node'
name='lastochka-jpa-acceptance-'+uuid.uuid4().hex[:10]; container=None; app=None; frontend=None

def freeport():
 s=socket.socket();s.bind(('127.0.0.1',0)); p=s.getsockname()[1];s.close();return p
port=freeport(); frontport=freeport()
def ready(url,proc,seconds=90):
 for _ in range(seconds*5):
  if proc.poll() is not None: raise RuntimeError('process exited; see isolated log')
  try:
   with urllib.request.urlopen(url,timeout=2) as r:
    if r.status==200:return
  except Exception:time.sleep(.2)
 raise RuntimeError('readiness timeout')
def stop(proc):
 if proc and proc.poll() is None:
  proc.terminate()
  try:proc.wait(15)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
def request_json(opener,path,method='GET',data=None,headers=None):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/lastochka'+path,data=json.dumps(data).encode() if data is not None else None,headers=headers or {},method=method)
 try:
  with opener.open(req,timeout=10) as r:return r.status,json.loads(r.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
try:
 container=subprocess.check_output(['docker','run','-d','--rm','--name',name,'-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_USER=fixture','-e','POSTGRES_DB=fixture','-p','127.0.0.1::5432','postgres:17.6-alpine'],text=True).strip()
 dbport=int(subprocess.check_output(['docker','port',name,'5432/tcp'],text=True).strip().rsplit(':',1)[1])
 for _ in range(100):
  if subprocess.run(['docker','exec',name,'pg_isready','-U','fixture','-d','fixture'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.2)
 else:raise RuntimeError('isolated database not ready')
 env=os.environ.copy();env.update(DATABASE_URL=f'jdbc:postgresql://127.0.0.1:{dbport}/fixture',DATABASE_USER='fixture',DATABASE_PASSWORD='fixture-only',PORT=str(port),LASTOCHKA_ADMIN_LOGIN='fixtureadmin',LASTOCHKA_ADMIN_NAME='Fixture',LASTOCHKA_ADMIN_PASSWORD='Fixture-pass-2026')
 with (temp/'bootstrap.log').open('wb') as f:
  init=subprocess.run([str(java),'-jar',str(old),'--lastochka.admin.create=true','--lastochka.workers.enabled=false'],env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 if init.returncode:raise RuntimeError('bootstrap failed; see isolated log')
 sql="INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES ('11111111-1111-1111-1111-111111111111','Fixture','GROUP','2044-01-01T10:00:00Z','2044-01-01T11:00:00Z',10,'OPEN'); INSERT INTO enrollment_requests(id,parent_name,phone) VALUES ('22222222-2222-2222-2222-222222222222','Fixture','+79001234567'); INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,created_by) SELECT '33333333-3333-3333-3333-333333333333',12345,'Fixture','Fixture','+79001234567',id FROM accounts WHERE login='fixtureadmin'; INSERT INTO user_entities(id,name,display_name) SELECT 'AQID',email,'Fixture key owner' FROM accounts WHERE login='fixtureadmin'; INSERT INTO user_credentials(credential_id,user_entity_user_id,public_key,signature_count,uv_initialized,backup_eligible,authenticator_transports,public_key_credential_type,backup_state,created,last_used,label) VALUES('BAUG','AQID',decode('aabb','hex'),0,true,false,'internal','public-key',false,now(),now(),'Fixture key'); INSERT INTO telegram_outbox(enquiry_id,body) VALUES ('22222222-2222-2222-2222-222222222222','Fixture message'); INSERT INTO enquiry_notification_routes(enquiry_id,telegram_enabled,browser_push_enabled) VALUES ('22222222-2222-2222-2222-222222222222',true,false);"
 subprocess.run(['docker','exec',name,'psql','-U','fixture','-d','fixture','-v','ON_ERROR_STOP=1','-c',sql],check=True,stdout=subprocess.DEVNULL)
 opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 results=[]
 for index,jar in enumerate([old,new,old]):
  with (temp/f'backend-{index}.log').open('wb') as f:app=subprocess.Popen([str(java),'-jar',str(jar),'--lastochka.workers.enabled=false'],env=env,stdout=f,stderr=subprocess.STDOUT)
  ready(f'http://127.0.0.1:{port}/lastochka/actuator/health/readiness',app)
  if index==0:
   status,token=request_json(opener,'/api/v1/auth/csrf'); assert status==200
   status,login=request_json(opener,'/api/v1/auth/password-stage','POST',{'login':'fixtureadmin','password':'Fixture-pass-2026'},{'Content-Type':'application/json',token['headerName']:token['token']});assert status==200 and login['state']=='FULL',(status,login)
   frontend_env=env.copy();frontend_env.update(PORT=str(frontport),BACKEND_INTERNAL_URL=f'http://127.0.0.1:{port}/lastochka',APP_BASE_PATH='/lastochka')
   with (temp/'frontend.log').open('wb') as f:frontend=subprocess.Popen([str(node),'server.mjs'],cwd=root/'frontend',env=frontend_env,stdout=f,stderr=subprocess.STDOUT)
   ready(f'http://127.0.0.1:{frontport}/readyz',frontend)
  checks={}
  for path in ['/api/v1/auth/me','/api/v1/auth/webauthn/credentials','/api/v1/public/landing','/api/v1/sessions?from=2044-01-01T00%3A00%3A00Z&to=2044-01-02T00%3A00%3A00Z','/api/v1/admin/users','/api/v1/admin/enquiries','/api/v1/admin/payment-requests','/v3/api-docs']:
   status,body=request_json(opener,path);assert status==200,(path,status,body);checks[path]=body
  assert 'Fixture key' in json.dumps(checks['/api/v1/auth/webauthn/credentials']), 'fixture credential missing'
  guest=urllib.request.build_opener()
  error_status,error_body=request_json(guest,'/api/v1/admin/users')
  error_body.pop('requestId',None)
  checks['guest_error']=[error_status,error_body]
  checks['/v3/api-docs'].pop('servers',None)
  with urllib.request.urlopen(f'http://127.0.0.1:{frontport}/readyz',timeout=10) as r:assert r.status==200
  with urllib.request.urlopen(f'http://127.0.0.1:{frontport}/lastochka/',timeout=10) as r:assert r.status==200 and len(r.read())>100
  results.append(checks)
  stop(app);app=None
 assert results[0]==results[1]==results[2], 'API/OpenAPI differs across versions'
 print('PASS old -> new -> old: warm ADMIN session, landing, schedule, users, enquiries, payments, OpenAPI, prior frontend readiness and landing; synthetic V18 database')
finally:
 stop(app);stop(frontend)
 if container:subprocess.run(['docker','stop',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
