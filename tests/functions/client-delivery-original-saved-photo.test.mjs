// Phase 5D original TEST: resume one existing encrypted upload ONLY.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continueOriginalTestSavedFirstPhotoOnce} from
 '../../supabase/functions/client-delivery/worker-runtime.mjs';
import {DriveUncertain} from
 '../../supabase/functions/client-delivery/drive-client.mjs';
import {createDeliveryHandler,safeTrustedDeliveryDiagnostic} from '../../supabase/functions/client-delivery/handler.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pkg=uuid(3),dest=uuid(4),worker=uuid(5),first=uuid(6),second=uuid(7);
const root='root_'+'a'.repeat(24),folder='folder_'+'b'.repeat(24);
const folderParent='wo_'+'c'.repeat(24),drive='drive_'+'d'.repeat(24);
const remote='photo_'+'e'.repeat(24),account='office@example.invalid';
const sha='f'.repeat(64),size=404185;
const properties={fwh_package:pkg,fwh_manifest:sha};
const proof={id:folder,parent:folderParent,mime:'application/vnd.google-apps.folder',
 name:'package-'+pkg,drive_id:drive,trashed:false,
 appProperties:properties,sha256:null,size:null};
const original={
 state:'ORIGINAL_TEST_FIRST_PHOTO_SAVED_PROGRESS_EXPIRED',
 package_id:pkg,destination_id:dest,root_id:root,
 worker_id:worker,generation:1,attempts:1,approved_sha256:sha,
 folder_plan_id:uuid(8),folder_remote_id:folder,folder_parent_id:folderParent,
 folder_name:'package-'+pkg,folder_proof:proof,
 photo_plan_id:first,photo_remote_id:remote,photo_parent_id:folder,
 photo_id:uuid(9),photo_sha256:sha,photo_size:size,drive_id:drive,
 session_state:'UPLOADING',recorded_offset:262144,session_revision:3,
 lease_until:'2020-01-01T00:00:00Z'
};
function rig({read=original,badFolder=false,resumeFail=false,
 outcome='FILE_VERIFIED',extraOffset=1000,sessionBad=false}={}){
 const events=[];
 let nextCalls=0,acceptedReads=0;
 const ledger={
  readSavedTestFirstPhoto:async(p,d,r)=>{
   events.push('read');assert.equal(p,pkg);assert.equal(d,dest);assert.equal(r,root);
   acceptedReads++;
   return acceptedReads===1?read:{...read,state:'ALREADY_CONSUMED'};
  },
  resumeSavedTestFirstPhoto:async(s,p,request)=>{
   events.push('resume');assert.equal(s.photo_remote_id,remote);
   assert.deepEqual(p,proof);assert.equal(request,uuid(12));
   if(resumeFail)throw new DriveUncertain('SERVICE_RPC_OUTCOME_UNCERTAIN');
   return {status:'ORIGINAL_TEST_SAVED_PHOTO_DISPATCH_ACQUIRED',
    package_id:pkg,worker_id:worker,generation:1,photo_plan_id:first,
    photo_remote_id:remote,previous_offset:262144,previous_revision:3,
    dispatch_id:uuid(12),expires_at:'2999-01-01T00:00:00Z'};
  },
  nextReservedItem:async()=>{
   events.push('next');
   nextCalls++;
   return nextCalls===1||outcome!=='FILE_VERIFIED'
     ?{state:'FILE',kind:'PHOTO',plan_id:first}
     :{state:'FILE',kind:'PHOTO',plan_id:second};
  },
  forLease:()=>({getSession:async()=>{
   events.push('session');
   return sessionBad?null:{
    package_id:pkg,plan_id:first,total_bytes:size,
    recorded_offset:262144+extraOffset,encrypted:{ciphertext:'dummy'}
   };
  }}),
  releaseDispatch:async(id)=>{
   events.push('release');assert.equal(id,uuid(12));return {released:true};
  }
 };
 const fetcher=async(url,options)=>{
  const u=new URL(url);events.push('google:'+u.pathname);
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(options.headers.Authorization,'Bearer private-token-not-for-client');
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:account,me:true,permissionId:'perm_abc'}});
  if(u.pathname==='/drive/v3/files/'+root)
   return Response.json({id:root,driveId:drive,trashed:false,
    mimeType:'application/vnd.google-apps.folder',
    capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/'+folder)
   return Response.json({id:folder,name:proof.name,driveId:drive,
    trashed:false,mimeType:proof.mime,parents:[badFolder?root:folderParent],
    appProperties:properties});
  throw Error('Unexpected Google operation: '+u.pathname);
 };
 const tokenProvider=async()=>{events.push('oauth');return {
  accessToken:'private-token-not-for-client',expiresInSeconds:3600
 };};
 const continueFile=async({packageId,planId,workerId,generation})=>{
  events.push('continue');
  assert.equal(packageId,pkg);assert.equal(planId,first);
  assert.equal(workerId,worker);assert.equal(generation,1);
  return outcome==='FILE_VERIFIED'
   ?{state:outcome,plan_id:first}
   :outcome==='PROGRESS'
    ?{state:outcome,plan_id:first,recorded_offset:262144+extraOffset}
    :{state:outcome,plan_id:first};
 };
 const input={ledger,tokenProvider,expectedEmail:account,
  expectedDriveId:drive,testPackageId:pkg,testDestinationId:dest,
  testRootId:root,projectUrl:'https://test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  vault:{seal:async()=>{},open:async()=>{}},
  fetcher,makeRequestId:()=>uuid(12),continueFile};
 return {events,input};
}
test('existing first-photo session can finish once using original saved IDs',async()=>{
 const x=rig();
 const a=await continueOriginalTestSavedFirstPhotoOnce(x.input);
 assert.equal(a.state,'ORIGINAL_TEST_SAVED_FIRST_PHOTO_VERIFIED');
 assert.deepEqual(x.events.slice(0,2),['read','oauth']);
 assert.equal(x.events.filter(e=>e==='resume').length,1);
 assert.ok(x.events.indexOf('resume')<x.events.indexOf('continue'));
 assert.ok(x.events.indexOf('continue')<x.events.indexOf('release'));
 assert.equal(x.events.some(e=>e.includes('generateIds')),false);
 await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),DriveUncertain);
 assert.equal(x.events.filter(e=>e==='continue').length,1);
});
test('existing session next-offset progress requires new durable journal read',async()=>{
 const x=rig({outcome:'PROGRESS'});
 const result=await continueOriginalTestSavedFirstPhotoOnce(x.input);
 assert.equal(result.state,'ORIGINAL_TEST_SAVED_FIRST_PHOTO_PROGRESS_VERIFIED');
 assert.ok(x.events.includes('session'));
});
test('wrong Google folder identity blocks SQL recovery and photo bytes',async()=>{
 const x=rig({badFolder:true});
 await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),DriveUncertain);
 assert.equal(x.events.includes('resume'),false);
 assert.equal(x.events.includes('continue'),false);
});
test('read denials and changed saved offsets stop before provider or SQL',async()=>{
 for(const wrong of [{...original,session_revision:2},
  {...original,recorded_offset:0},
  {...original,photo_remote_id:'invalid/remote/id'},
  {...original,state:'ALREADY_CONSUMED'}]){
  const x=rig({read:wrong});
  await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),DriveUncertain);
  assert.deepEqual(x.events,['read']);
 }
});
test('lost atomic SQL acknowledgement is never followed by a Google PUT',async()=>{
 const x=rig({resumeFail:true});
 await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),
  e=>e instanceof DriveUncertain && e.code==='SERVICE_RPC_OUTCOME_UNCERTAIN');
 assert.equal(x.events.includes('continue'),false);
 assert.equal(x.events.includes('release'),false);
});
test('incomplete final GET and malformed progress preserve permit for reconciliation',async()=>{
 for(const kind of ['NEEDS_INDEPENDENT_GET','PROGRESS']){
  const x=rig(kind==='PROGRESS'
   ?{outcome:kind,extraOffset:0}:{outcome:kind});
  await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),
   DriveUncertain);
  assert.equal(x.events.includes('release'),false);
 }
});
test('saved session missing after provider-reported progress never passes',async()=>{
 const x=rig({outcome:'PROGRESS',sessionBad:true});
 await assert.rejects(()=>continueOriginalTestSavedFirstPhotoOnce(x.input),
  DriveUncertain);
 assert.equal(x.events.includes('release'),false);
});
test('source migration is one-shot, service-only and does not relax existing guard',()=>{
 const sql=readFileSync('supabase/migrations/20261025130000_phase_5_original_test_saved_session_continuation.sql','utf8');
 assert.match(sql,/primary key[\s\S]{0,90}references private\.client_delivery_test_first_photo_continuations/);
 assert.match(sql,/client_delivery_upload_sessions/);
 assert.match(sql,/sess\.ciphertext is null/);
 assert.match(sql,/sess\.recorded_offset<=0/);
 assert.match(sql,/lease_until is distinct from p_expected_lease_until/);
 assert.match(sql,/s\.revision is distinct from p_expected_revision/);
 assert.match(sql,/service_acquire_delivery_dispatch/);
 assert.match(sql,/client_delivery_worker_readiness_actions/);
 assert.match(sql,/TEST_WORKER_CRYPTO_PROVIDER_READ_ONLY/);
 assert.match(sql,/last_verified_at=clock_timestamp\(\)/);
 assert.match(sql,/client_delivery_dispatch_permit/);
 assert.match(sql,/revoke all on function[\s\S]+from public,anon,authenticated,service_role/);
 assert.match(sql,/to service_role;/);
 assert.doesNotMatch(sql,/create extension|drop table|truncate|alter role/i);
});

test('hosted narrow recovery route requires exact one-field body and TEST settings',async()=>{
 let calls=0;
 const cfg={
  enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
  workerSecret:'disposable-test-worker-only-1234567890',
  testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testReleasePackageId:pkg,testReleaseDestinationId:dest,
  testRootFolderId:root,expectedDriveId:drive,
  internalDriveId:'internal_'+('a'.repeat(22)),
  testWorkspaceDomain:'example.invalid',expectedAccount:account,
  clientId:'disposable-client-id',clientSecret:'disposable-client-secret',
  refreshToken:'disposable-refresh-token',
  oauthScope:'https://www.googleapis.com/auth/drive.file',
  supabaseUrl:'https://disposable-fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  sessionVaultKey:Buffer.alloc(32,7).toString('base64url'),
  continueOriginalSavedTestPhoto:async()=>{calls++;return {
   state:'ORIGINAL_TEST_SAVED_FIRST_PHOTO_VERIFIED'
  };},
  fetcher:()=>{throw Error('No real provider in handler mock');}
 };
 const makeReq=(body,workerSecret=cfg.workerSecret)=>new Request('https://irrelevant.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':workerSecret,
   'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 const h=createDeliveryHandler(cfg);
 const good=await h(makeReq({operation:'continue_original_saved_first_photo_once'}));
 assert.equal(good.status,200,await good.text());
 assert.equal(calls,1);
 for(const body of [
  {operation:'continue_original_saved_first_photo_once',package_id:pkg},
  {operation:'continue_original_saved_first_photo_once',force:true},
  ['continue_original_saved_first_photo_once']
 ]){
  const res=await h(makeReq(body));
  assert.equal(res.status,400);
  assert.equal((await res.json()).status,'EXACT_REQUEST_REQUIRED');
 }
 assert.equal(calls,1);
 const unauth=await h(makeReq(
  {operation:'continue_original_saved_first_photo_once'},'wrong-worker-key'));
 assert.equal(unauth.status,401);
 const disabled=createDeliveryHandler({...cfg,testRecoveryEnabled:false});
 const denied=await disabled(makeReq({operation:'continue_original_saved_first_photo_once'}));
 assert.notEqual(denied.status,200);
 assert.equal(calls,1);
});
test('saved-session route never says VERIFIED on uncertain coordinator outcome',async()=>{
 const secret='disposable-test-worker-only-1234567890';
 const h=createDeliveryHandler({
  enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
  workerSecret:secret,testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
  testReleasePackageId:pkg,testReleaseDestinationId:dest,
  testRootFolderId:root,expectedDriveId:drive,
  internalDriveId:'internal_'+('a'.repeat(22)),
  expectedAccount:account,testWorkspaceDomain:'example.invalid',
  clientId:'test-client',clientSecret:'test-secret',refreshToken:'test-refresh',
  oauthScope:'https://www.googleapis.com/auth/drive.file',
  supabaseUrl:'https://disposable-fwh-test.supabase.co',serviceRoleJwt:'header.payload.signature',
  sessionVaultKey:Buffer.alloc(32,9).toString('base64url'),
  continueOriginalSavedTestPhoto:async()=>{throw new Error('uncertain-google-response');}
 });
 const response=await h(new Request('https://irrelevant.invalid',{
  method:'POST',headers:{'x-fwh-delivery-secret':secret,
   'Content-Type':'application/json'},
  body:JSON.stringify({operation:'continue_original_saved_first_photo_once'})
 }));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),
  {status:'ORIGINAL_TEST_SAVED_FIRST_PHOTO_UNVERIFIED'});
});

test('private failure diagnostics retain only approved code, HTTP status and stage',()=>{
 assert.deepEqual(safeTrustedDeliveryDiagnostic(
  new DriveUncertain('PROVIDER_IDENTITY_UNCERTAIN',404,'GOOGLE_SESSION_STATUS')),
  {code:'PROVIDER_IDENTITY_UNCERTAIN',provider_http_status:404,
   provider_step:'GOOGLE_SESSION_STATUS'});
 const unsafe=new Error('secret-token-and-session-url');
 unsafe.code='PROVIDER_IDENTITY_UNCERTAIN';
 unsafe.providerHttpStatus=404;
 unsafe.providerStep='GOOGLE_SESSION_STATUS';
 assert.deepEqual(safeTrustedDeliveryDiagnostic(unsafe),
  {code:'UNCLASSIFIED_UNCERTAIN',provider_http_status:null,provider_step:null});
 assert.equal(JSON.stringify(safeTrustedDeliveryDiagnostic(unsafe))
  .includes('secret-token'),false);
});
