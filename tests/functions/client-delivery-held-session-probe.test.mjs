import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectOriginalHeldFirstPhotoSession,inspectOriginalHeldFirstPhotoFile} from
 '../../supabase/functions/client-delivery/held-session-probe.mjs';
import {DriveUncertain} from
 '../../supabase/functions/client-delivery/drive-client.mjs';
import {createDeliveryHandler} from
 '../../supabase/functions/client-delivery/handler.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pkg=uuid(11),dest=uuid(12),worker=uuid(13),plan=uuid(14);
const remote='photo_'+('a'.repeat(24)),parent='folder_'+('b'.repeat(24));
const root='root_'+('c'.repeat(24)),drive='drive_'+('d'.repeat(24));
const account='test@example.invalid';
const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private';
const descriptor={
 status:'ORIGINAL_TEST_HELD_FIRST_PHOTO_EXACT',
 package_id:pkg,destination_id:dest,root_id:root,
 worker_id:worker,generation:1,photo_plan_id:plan,
 photo_remote_id:remote,parent_remote_id:parent,drive_id:drive,
 expected_size:404185,saved_offset:262144,session_revision:3,
 sealed_session:{version:1,nonce:'encrypted',payload:'encrypted'}
};
function harness({status=308,range='bytes=0-262143',descriptorValue=descriptor,invalidUrl=null}={}){
 const events=[];
 const ledger={readHeldTestFirstPhoto:async(p,d,r)=>{
  events.push('sql_read');assert.equal(p,pkg);assert.equal(d,dest);
  assert.equal(r,root);return descriptorValue;
 }};
 const vault={open:async(blob,identity)=>{
  events.push('decrypt');assert.equal(identity.packageId,pkg);
  assert.equal(identity.fileId,remote);assert.equal(blob.version,1);
  return invalidUrl??session;
 }};
 const fetcher=async(url,init)=>{
  const u=new URL(url);
  if(u.pathname==='/drive/v3/about'){
   events.push('account_get');assert.equal(init.method??'GET','GET');
   return Response.json({user:{emailAddress:account,permissionId:'permission',me:true}});
  }
  events.push('status_query');
  assert.equal(url,session);
  assert.equal(init.method,'PUT');
  assert.equal(init.redirect,'manual');
  assert.equal(init.body,undefined);
  assert.equal(init.headers['Content-Length'],'0');
  assert.equal(init.headers['Content-Range'],'bytes */404185');
  assert.match(init.headers.Authorization,/^Bearer /);
  return new Response(null,{status,headers:range?{Range:range}:{}});
 };
 const tokenProvider=async()=>({accessToken:'secret-token-for-mock-only',expiresInSeconds:3600});
 const opts={ledger,vault,fetcher,tokenProvider,testPackageId:pkg,
  testDestinationId:dest,testRootId:root,expectedDriveId:drive,expectedEmail:account};
 return {events,opts};
}
test('held 308 status query returns exact provider offset but never upload bytes',async()=>{
 const x=harness();
 const out=await inspectOriginalHeldFirstPhotoSession(x.opts);
 assert.deepEqual(out,{status:'HELD_TEST_SESSION_INCOMPLETE',http_status:308,
  saved_offset:262144,provider_offset:262144});
 assert.deepEqual(x.events,['sql_read','decrypt','account_get','status_query']);
 assert.doesNotMatch(JSON.stringify(out),/upload_id|secret-token|photo_/);
});
test('no Range on Google 308 means provider offset zero, never a retry permit',async()=>{
 const x=harness({range:null});
 const out=await inspectOriginalHeldFirstPhotoSession(x.opts);
 assert.equal(out.provider_offset,0);
 assert.equal(x.events.filter(x=>x==='status_query').length,1);
});
test('200/201 are only completion candidates, never verified photo receipts',async()=>{
 for(const status of [200,201]){
  const x=harness({status,range:null});
  const out=await inspectOriginalHeldFirstPhotoSession(x.opts);
  assert.deepEqual(out,{status:'HELD_TEST_SESSION_COMPLETE_CANDIDATE',http_status:status,
   saved_offset:262144,provider_offset:null});
 }
});
test('Google 404 and 401/403 are classified without disclosing response body',async()=>{
 for(const [status,expected] of [[404,'HELD_TEST_SESSION_UNAVAILABLE_404'],
  [401,'HELD_TEST_SESSION_AUTH_DENIED'],[403,'HELD_TEST_SESSION_AUTH_DENIED'],
  [500,'HELD_TEST_SESSION_PROVIDER_OTHER']]){
  const x=harness({status});
  const out=await inspectOriginalHeldFirstPhotoSession(x.opts);
  assert.equal(out.status,expected);
  assert.equal(out.http_status,status);
  assert.equal(out.provider_offset,null);
 }
});
test('missing held permit authority or tampered file identity denies BEFORE probe',async()=>{
 for(const bad of [{...descriptor,photo_remote_id:'tampered/'+remote},
  {...descriptor,generation:2},{...descriptor,saved_offset:0},
  {...descriptor,sealed_session:null}]){
  const x=harness({descriptorValue:bad});
  await assert.rejects(()=>inspectOriginalHeldFirstPhotoSession(x.opts),DriveUncertain);
  assert.deepEqual(x.events,['sql_read']);
 }
 const x=harness();
 x.opts.ledger.readHeldTestFirstPhoto=async()=>{
  throw new DriveUncertain('HELD_ORIGINAL_PERMIT_REQUIRED');
 };
 await assert.rejects(()=>inspectOriginalHeldFirstPhotoSession(x.opts),DriveUncertain);
 assert.deepEqual(x.events,[]);
});
test('tampered resumable URL blocks provider calls before any status PUT',async()=>{
 const x=harness({invalidUrl:'https://evil.invalid/upload'});
 await assert.rejects(()=>inspectOriginalHeldFirstPhotoSession(x.opts),DriveUncertain);
 assert.deepEqual(x.events,['sql_read','decrypt']);
});
test('malformed Range and uncertain transport cannot become positive receipt',async()=>{
 const x=harness({range:'bytes=123-222'});
 await assert.rejects(()=>inspectOriginalHeldFirstPhotoSession(x.opts),DriveUncertain);
 assert.equal(x.events.filter(v=>v==='status_query').length,1);
 const y=harness();
 y.opts.fetcher=async(url,init)=>{
  if(new URL(url).pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:account,permissionId:'perm',me:true}});
  throw Error('network disconnected');
 };
 const out=await inspectOriginalHeldFirstPhotoSession(y.opts);
 assert.equal(out.status,'HELD_TEST_SESSION_TRANSPORT_UNCERTAIN');
 assert.equal(out.http_status,null);
});
test('TEST handler restricts diagnostic to one exact operation and private header',async()=>{
 let calls=0;
 const cfg={
  enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
  workerSecret:'disposable-test-worker-only-1234567890',
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testReleasePackageId:pkg,testReleaseDestinationId:dest,
  testRootFolderId:root,expectedDriveId:drive,
  internalDriveId:'internal_'+('e'.repeat(24)),
  testWorkspaceDomain:'example.invalid',expectedAccount:account,
  clientId:'disposable-client-id',clientSecret:'disposable-client-secret',
  refreshToken:'disposable-refresh-token',
  oauthScope:'https://www.googleapis.com/auth/drive.file',
  supabaseUrl:'https://example-fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  sessionVaultKey:Buffer.alloc(32,6).toString('base64url'),
  inspectHeldTestSession:async()=>{calls++;return {
   status:'HELD_TEST_SESSION_UNAVAILABLE_404',http_status:404,
   saved_offset:262144,provider_offset:null
  };}
 };
 const request=(body,secret=cfg.workerSecret)=>new Request('https://placeholder.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':secret,
   'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 const h=createDeliveryHandler(cfg);
 const good=await h(request({operation:'inspect_original_held_first_photo_session'}));
 assert.equal(good.status,200,await good.clone().text());
 assert.deepEqual(await good.json(),{
  status:'HELD_TEST_SESSION_UNAVAILABLE_404',
  http_status:404,saved_offset:262144,provider_offset:null
 });
 assert.equal(calls,1);
 for(const body of [
  {operation:'inspect_original_held_first_photo_session',file_id:remote},
  {operation:'inspect_original_held_first_photo_session',force:true},
  ['inspect_original_held_first_photo_session']
 ]){
  const denied=await h(request(body));
  assert.equal(denied.status,400);
 }
 const wrong=await h(request({operation:'inspect_original_held_first_photo_session'},'wrong'));
 assert.equal(wrong.status,401);
 const off=createDeliveryHandler({...cfg,testRecoveryEnabled:false});
 const disabled=await off(request({operation:'inspect_original_held_first_photo_session'}));
 assert.notEqual(disabled.status,200);
 assert.equal(calls,1);
});
test('handler never returns raw diagnostic credentials after downstream failure',async()=>{
 const key='disposable-test-worker-only-1234567890';
 const config={
  enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
  workerSecret:key,testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testReleasePackageId:pkg,testReleaseDestinationId:dest,
  testRootFolderId:root,expectedDriveId:drive,
  internalDriveId:'internal_'+('e'.repeat(24)),
  testWorkspaceDomain:'example.invalid',expectedAccount:account,
  clientId:'disposable-client-id',clientSecret:'disposable-client-secret',
  refreshToken:'disposable-refresh-token',
  oauthScope:'https://www.googleapis.com/auth/drive.file',
  supabaseUrl:'https://example-fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  sessionVaultKey:Buffer.alloc(32,6).toString('base64url'),
  inspectHeldTestSession:async()=>{throw new Error('PRIVATE:'+session);}
 };
 const h=createDeliveryHandler(config);
 const res=await h(new Request('https://placeholder.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':key,
   'Content-Type':'application/json'},
  body:JSON.stringify({operation:'inspect_original_held_first_photo_session'})
 }));
 assert.equal(res.status,503);
 const text=await res.text();
 assert.deepEqual(JSON.parse(text),{status:'HELD_TEST_SESSION_DIAGNOSTIC_UNVERIFIED'});
 assert.doesNotMatch(text,/PRIVATE|upload_id|Bearer/);
});
test('migration only adds held forensic service RPC, with no mutations',()=>{
 const sql=readFileSync('supabase/migrations/20261026150000_phase_5_original_test_held_session_probe.sql','utf8');
 assert.match(sql,/permit\.request_id is distinct from c\.request_id/);
 assert.match(sql,/s\.recorded_offset is distinct from c\.previous_offset/);
 assert.match(sql,/s\.revision is distinct from c\.previous_revision/);
 assert.match(sql,/s\.ciphertext->>'version' is distinct from '1'/);
 assert.match(sql,/service_read_exact_held_first_photo_probe/);
 assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated,service_role/);
 assert.match(sql,/to service_role;/);
 assert.doesNotMatch(sql,/\b(insert|update|delete|truncate|drop|alter table|create table)\b/i);
 const code=readFileSync('supabase/functions/client-delivery/held-session-probe.mjs','utf8');
 assert.doesNotMatch(code,/uploadChunk|startResumable|beginSession|recordOffset|releaseDispatch/);
 assert.match(code,/'Content-Length':'0'/);
 assert.match(code,/'Content-Range':'bytes \*\/'/);
});


// Separate forensic fact: 404 for an upload *session* does not establish
// whether the original preallocated FILE ID was remotely committed.
function originalFileFixture(status=404,metadata=null,descriptorValue=descriptor){
 const events=[];
 const ledger={readHeldTestFirstPhoto:async(p,d,r)=>{
  events.push('sql_read');
  assert.equal(p,pkg);assert.equal(d,dest);assert.equal(r,root);
  return descriptorValue;
 }};
 const fetcher=async(url,init)=>{
  const u=new URL(url);
  assert.equal(init.method??'GET','GET');
  assert.equal(init.redirect,'error');
  assert.equal(init.body,undefined);
  if(u.pathname==='/drive/v3/about'){
   events.push('account_get');
   return Response.json({user:{emailAddress:account,permissionId:'perm',me:true}});
  }
  events.push('file_get');
  assert.equal(u.pathname,'/drive/v3/files/'+remote);
  assert.equal(u.searchParams.get('supportsAllDrives'),'true');
  assert.match(u.searchParams.get('fields'),/appProperties/);
  return status===404?new Response(null,{status}):Response.json(metadata);
 };
 const opts={ledger,fetcher,testPackageId:pkg,
  testDestinationId:dest,testRootId:root,expectedDriveId:drive,
  expectedEmail:account,tokenProvider:async()=>({
   accessToken:'private-disposable-test-mock-token',
   expiresInSeconds:3600
  })};
 return {opts,events};
}
test('held original PHOTO ID 404 is isolated from expired resumable session',async()=>{
 const x=originalFileFixture();
 assert.deepEqual(await inspectOriginalHeldFirstPhotoFile(x.opts),{
  status:'HELD_TEST_FILE_NOT_FOUND_404',http_status:404
 });
 assert.deepEqual(x.events,['sql_read','account_get','file_get']);
});
test('held photo metadata is a CANDIDATE only; mismatches are not receipts',async()=>{
 const metadata={id:remote,name:'field-photo.jpg',mimeType:'image/jpeg',
  parents:[parent],driveId:drive,trashed:false,
  appProperties:{fwh_package:pkg,fwh_manifest:'a'.repeat(64)}};
 const x=originalFileFixture(200,metadata);
 assert.deepEqual(await inspectOriginalHeldFirstPhotoFile(x.opts),{
  status:'HELD_TEST_FILE_PRESENT_CANDIDATE',http_status:200
 });
 for(const bad of [
  {...metadata,id:'wrong_'+remote},
  {...metadata,parents:[root]},
  {...metadata,driveId:root},
  {...metadata,trashed:true},
  {...metadata,appProperties:{...metadata.appProperties,fwh_package:dest}},
  {...metadata,appProperties:{fwh_package:pkg}}
 ]){
  const testCase=originalFileFixture(200,bad);
  assert.deepEqual(await inspectOriginalHeldFirstPhotoFile(testCase.opts),{
   status:'HELD_TEST_FILE_IDENTITY_MISMATCH',http_status:200
  });
 }
});
test('held original PHOTO ID refuses changed SQL identity before provider GET',async()=>{
 const x=originalFileFixture(200,{}, {...descriptor,photo_remote_id:'wrong/id'});
 await assert.rejects(()=>inspectOriginalHeldFirstPhotoFile(x.opts),DriveUncertain);
 assert.deepEqual(x.events,['sql_read']);
});
test('metadata probe handler requires private header, exact input and recovery mode',async()=>{
 const config={
  enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
  workerSecret:'disposable-test-worker-only-1234567890',
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testReleasePackageId:pkg,testReleaseDestinationId:dest,
  testRootFolderId:root,expectedDriveId:drive,
  internalDriveId:'internal_'+('e'.repeat(24)),
  testWorkspaceDomain:'example.invalid',expectedAccount:account,
  clientId:'disposable-client-id',clientSecret:'disposable-client-secret',
  refreshToken:'disposable-refresh-token',
  oauthScope:'https://www.googleapis.com/auth/drive.file',
  supabaseUrl:'https://disposable-fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  inspectHeldTestFile:async()=>({
   status:'HELD_TEST_FILE_NOT_FOUND_404',http_status:404
  })
 };
 const request=(body,key=config.workerSecret)=>new Request('https://test.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':key,
   'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 const h=createDeliveryHandler(config);
 const good=await h(request({operation:'inspect_original_held_first_photo_file'}));
 assert.equal(good.status,200,await good.clone().text());
 assert.deepEqual(await good.json(),{
  status:'HELD_TEST_FILE_NOT_FOUND_404',http_status:404
 });
 for(const body of [
  {operation:'inspect_original_held_first_photo_file',file_id:remote},
  {operation:'inspect_original_held_first_photo_file',retry:true},
  ['inspect_original_held_first_photo_file']
 ]){
  assert.equal((await h(request(body))).status,400);
 }
 const badKey=await h(request({operation:'inspect_original_held_first_photo_file'},
  'incorrect-worker-secret'));
 assert.equal(badKey.status,401);
 const off=createDeliveryHandler({...config,testRecoveryEnabled:false});
 assert.notEqual((await off(request({
  operation:'inspect_original_held_first_photo_file'}))).status,200);
});
