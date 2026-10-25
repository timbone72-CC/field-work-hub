import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExpiredReservedParent,resumeInspectedExpiredTestLease,
 recoverAndContinueOriginalTestParentOnce,
 reconcileOriginalAttemptedTestParentOnce,
 continueOriginalVerifiedTestToWorkOrderOnce,
 continueOriginalVerifiedTestToPackageOnce}
 from '../../supabase/functions/client-delivery/worker-runtime.mjs';
import {DriveUncertain}
 from '../../supabase/functions/client-delivery/drive-client.mjs';
import {createServiceLedger}
 from '../../supabase/functions/client-delivery/service-ledger.mjs';
import {createDeliveryHandler}
 from '../../supabase/functions/client-delivery/handler.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const packageId=uuid(1),destinationId=uuid(2),workerId=uuid(3),mapId=uuid(4);
const root='client_test_root_0123456789',originalId='reserved_google_folder_0123456789';
const driveId='shared_drive_0123456789',sha='a'.repeat(64);
const scope='operator@example.invalid',secret='test-only-worker-secret-012345678901';
const saved={
 state:'EXPIRED_RESERVED_PARENT',package_id:packageId,destination_id:destinationId,
 worker_id:workerId,generation:1,attempts:1,approved_sha256:sha,
 lease_until:new Date(Date.now()-60000).toISOString(),
 file_plans:0,upload_sessions:0,final_receipts:0,dispatch_permits:0,
 manifest:{package_id:packageId,destination_id:destinationId,
  destination_root:root,selected_photos:[{photo_id:uuid(10)},{photo_id:uuid(11)}]},
 parent:{map_id:mapId,kind:'ADDRESS',state:'RESERVED',create_attempts:0,
  remote_folder_id:originalId,parent_remote_id:root}
};
const copy=value=>structuredClone(value);
const args={testPackageId:packageId,testDestinationId:destinationId,
 testRootId:root,expectedEmail:scope,expectedDriveId:driveId};
const isCode=(code)=>e=>e instanceof DriveUncertain&&e.code===code;
function rig({snapshot=saved,remoteStatus=404,rootAccess=true,oauthFail=false}={}){
 const events=[];
 return {
  events,
  opts:{
   ...args,
   ledger:{readExpiredReservation:async(p,d,r)=>{
    assert.deepEqual([p,d,r],[packageId,destinationId,root]);
    events.push('exact-read');return snapshot;
   }},
   tokenProvider:async()=>{
    events.push('oauth');if(oauthFail)throw Error('redacted');
    return {accessToken:'disposable-token-0123456789012345',expiresInSeconds:3600};
   },
   fetcher:async(url,init)=>{
    const target=new URL(url);events.push(target.pathname);
    assert.equal(target.origin,'https://www.googleapis.com');
    assert.equal(init.method??'GET','GET');
    assert.equal(init.redirect,'error');
    if(target.pathname==='/drive/v3/about')
      return Response.json({user:{emailAddress:scope,me:true,permissionId:'test-permission'}});
    if(target.pathname==='/drive/v3/files/'+root)
      return Response.json({id:root,trashed:false,
       mimeType:'application/vnd.google-apps.folder',driveId,
       capabilities:{canAddChildren:rootAccess}});
    if(target.pathname==='/drive/v3/files/'+originalId){
      assert.equal(target.searchParams.get('supportsAllDrives'),'true');
      return remoteStatus===404?Response.json({error:'not found'}, {status:404})
       :remoteStatus===200?Response.json({id:originalId,trashed:false,
          mimeType:'application/vnd.google-apps.folder',driveId})
       :Response.json({error:'do not expose'}, {status:remoteStatus});
    }
    throw Error('Unexpected provider call');
   }
  }
 };
}
test('expired first reservation inspection reads only original identity, no create or lease writes',async()=>{
 const r=rig();const output=await inspectExpiredReservedParent(r.opts);
 assert.equal(output.state,'ORIGINAL_RESERVED_ID_NOT_FOUND');
 assert.equal(output.remote_folder_id,originalId);
 assert.equal(output.worker_id,workerId);
 assert.equal(output.generation,1);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
 assert.equal(r.events.some(x=>/generateIds|upload|rpc|POST/.test(x)),false);
});
test('expired reservation rejects every changed immutable scope before Google',async()=>{
 const changed=[
  x=>x.package_id=uuid(92),x=>x.destination_id=uuid(92),
  x=>x.worker_id=null,x=>x.generation=2,x=>x.attempts=2,
  x=>x.approved_sha256='not-a-hash',
  x=>x.manifest.selected_photos.pop(),
  x=>x.manifest.destination_root='another_root_01234567',
  x=>x.parent.map_id=null,x=>x.parent.kind='WORK_ORDER',
  x=>x.parent.create_attempts=1,x=>x.parent.state='ATTEMPTED',
  x=>x.parent.remote_folder_id='bad',
  x=>x.parent.parent_remote_id='foreign_parent_0123456789',
  x=>x.file_plans=1,x=>x.upload_sessions=1,
  x=>x.final_receipts=1,x=>x.dispatch_permits=1
 ];
 for(const edit of changed){
  const snapshot=copy(saved);edit(snapshot);
  const r=rig({snapshot});
  await assert.rejects(()=>inspectExpiredReservedParent(r.opts),
   isCode('EXPIRED_ORIGINAL_IDENTITY_UNVERIFIED'));
  assert.deepEqual(r.events,['exact-read']);
 }
});
test('a present or inaccessible original ID never authorizes a new folder',async()=>{
 for(const status of [200,401,403,500]){
  const r=rig({remoteStatus:status});
  await assert.rejects(()=>inspectExpiredReservedParent(r.opts),e=>
    e instanceof DriveUncertain);
  assert.equal(r.events.at(-1),'/drive/v3/files/'+originalId);
 }
 for(const overrides of [{rootAccess:false},{oauthFail:true}]){
  const r=rig(overrides);
  await assert.rejects(()=>inspectExpiredReservedParent(r.opts),e=>
    e instanceof DriveUncertain);
  assert.equal(r.events.includes('/drive/v3/files/'+originalId),false);
 }
});
test('not-yet-installed service-only recovery snapshot RPC fails closed without broad fallback',async()=>{
 const calls=[];
 const ledger=createServiceLedger({
  url:'https://fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  fetcher:async(url,opts)=>{
    calls.push({url,opts});
    return Response.json({code:'PGRST202',details:'private data'},{status:404});
  }
 });
 await assert.rejects(()=>ledger.readExpiredReservation(packageId,destinationId,root),
  isCode('SERVICE_RPC_UNAVAILABLE'));
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_read_expired_test_delivery_reservation');
 assert.deepEqual(JSON.parse(calls[0].opts.body),{
  p_package:packageId,p_destination:destinationId,p_root:root
 });
});
const atomicReceipt=proof=>({
 status:'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED',
 package_id:packageId,worker_id:workerId,generation:1,map_id:mapId,
 remote_folder_id:originalId,dispatch_id:proof.request_id,
 expires_at:new Date(Date.now()+120000).toISOString()
});
const noContinuation=r=>{
 for(const name of ['acquireDispatch','releaseDispatch','heartbeat','readParent',
  'beginParentCreate','confirmParent']){
  r.opts.ledger[name]=()=>{throw Error('NO_CONTINUATION_WITHOUT_ATOMIC_PROOF');};
 }
};

test('original-ID 404 permits one atomic SQL lease-and-dispatch handoff',async()=>{
 const r=rig(),savedCalls=[];
 r.opts.ledger.recoverAndAcquireDispatch=async proof=>{
  savedCalls.push(proof);
  assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
   '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
  assert.equal(proof.package_id,packageId);
  assert.equal(proof.destination_id,destinationId);
  assert.equal(proof.root_id,root);
  assert.equal(proof.worker_id,workerId);
  assert.equal(proof.generation,1);
  assert.equal(proof.map_id,mapId);
  assert.equal(proof.remote_folder_id,originalId);
  assert.equal(proof.lease_until,saved.lease_until);
  assert.equal(proof.request_id,uuid(88));
  assert.ok(Date.now()-Date.parse(proof.observed_at)<5000);
  return atomicReceipt(proof);
 };
 const result=await resumeInspectedExpiredTestLease({
  ...r.opts,makeRequestId:()=>uuid(88)
 });
 assert.equal(result.state,'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED');
 assert.equal(result.dispatch_id,uuid(88));
 assert.equal(savedCalls.length,1);
 assert.equal(r.events.some(x=>/upload|generateIds|POST/.test(x)),false);
});

test('ambiguous or wrong-ID provider observations NEVER invoke atomic recovery',async()=>{
 for(const remoteStatus of [200,401,403,500]){
  const r=rig({remoteStatus});let calls=0;
  r.opts.ledger.recoverAndAcquireDispatch=()=>{calls++;throw Error('forbidden');};
  await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
  assert.equal(calls,0);
 }
 const r=rig({snapshot:{...saved,lease_until:new Date(Date.now()+120000).toISOString()}});
 let calls=0;
 r.opts.ledger.recoverAndAcquireDispatch=()=>{calls++;throw Error('forbidden');};
 await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
 assert.equal(calls,0);
});

test('lost atomic SQL response stops without a second recovery or dispatch',async()=>{
 const r=rig();let calls=0;
 r.opts.ledger.recoverAndAcquireDispatch=async()=>{calls++;throw Error('network lost');};
 await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
 assert.equal(calls,1);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
});

test('atomic service-role recovery uses one narrowly scoped RPC and frozen permit ID',async()=>{
 const seen=[];
 const ledger=createServiceLedger({url:'https://fwh-test.supabase.co',
  serviceRoleJwt:'header.payload.signature',
  fetcher:async(url,opts)=>{seen.push({url,opts});return Response.json({status:'UNCERTAIN'});}
 });
 await ledger.recoverAndAcquireDispatch({
  package_id:packageId,destination_id:destinationId,root_id:root,
  worker_id:workerId,generation:1,map_id:mapId,remote_folder_id:originalId,
  lease_until:saved.lease_until,observed_at:new Date().toISOString(),
  request_id:uuid(90)
 });
 assert.equal(seen.length,1);
 assert.equal(new URL(seen[0].url).pathname,
  '/rest/v1/rpc/service_resume_and_acquire_exact_test_dispatch');
 const body=JSON.parse(seen[0].opts.body);
 assert.equal(body.p_root,root);
 assert.equal(body.p_worker,workerId);
 assert.equal(body.p_remote_id,originalId);
 assert.equal(body.p_probe_result,'GOOGLE_FILE_ID_NOT_FOUND');
 assert.equal(body.p_request,uuid(90));
 assert.equal(body.p_request,uuid(90));
 assert.equal(seen[0].opts.headers.Authorization,'Bearer header.payload.signature');
});

test('hosted worker still refuses all recovery-write operations',async()=>{
 const handler=createDeliveryHandler({enabled:true,workerSecret:secret});
 for(const operation of ['recover_expired_once','recover_original_parent_once']){
  const response=await handler(new Request('https://worker.invalid',{
   method:'POST',headers:{'content-type':'application/json',
    'x-fwh-delivery-secret':secret},
   body:JSON.stringify({operation})
  }));
  assert.equal(response.status,400,operation);
  assert.deepEqual(await response.json(),{status:'EXACT_REQUEST_REQUIRED'},operation);
 }
});

const hostedRecoveryOpts={
 enabled:false,testPreflightEnabled:true,testRecoveryEnabled:true,
 workerSecret:secret,testEvidenceClass:'DISPOSABLE_FWH_TEST_ONLY',
 testReleasePackageId:packageId,testReleaseDestinationId:destinationId,
 testRootFolderId:root,expectedDriveId:driveId,
 internalDriveId:'internal_shared_drive_0123456789',
 testWorkspaceDomain:'example.invalid',expectedAccount:scope,
 supabaseUrl:'https://fwh-test.supabase.co',
 serviceRoleJwt:'header.payload.signature',
 oauthScope:'https://www.googleapis.com/auth/drive',
 clientId:'disposable-oauth-client-00001',
 clientSecret:'disposable-client-secret-0001',
 refreshToken:'disposable-refresh-token-0001',
 fetcher:()=>{throw Error('TEST_ROUTE_MUST_NOT_TOUCH_NETWORK');},
 makeWorkerId:()=>uuid(98)
};
function recoveryRequest(body,credential=secret){
 return new Request('https://worker.invalid',{
  method:'POST',headers:{'content-type':'application/json',
   'x-fwh-delivery-secret':credential},body:JSON.stringify(body)
 });
}
test('hosted recovery operation is independently default OFF and never enables generic delivery',async()=>{
 const disabled=createDeliveryHandler({...hostedRecoveryOpts,testRecoveryEnabled:false});
 const denied=await disabled(recoveryRequest({operation:'recover_original_parent_once'}));
 assert.equal(denied.status,400);
 assert.deepEqual(await denied.json(),{status:'EXACT_REQUEST_REQUIRED'});
 for(const values of [{enabled:true},{testPreflightEnabled:false}]){
  const conflicting=createDeliveryHandler({...hostedRecoveryOpts,...values});
  const response=await conflicting(recoveryRequest({operation:'recover_original_parent_once'}));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{status:'CONFLICTING_WORKER_MODES'});
 }
});

test('hosted original-only TEST route denies wrong secret, extra caller IDs and wrong frozen destination',async()=>{
 let calls=0;
 const handler=createDeliveryHandler({...hostedRecoveryOpts,
  recoverOriginalTestParent:()=>{calls++;throw Error('MUST_NOT_CALL');}
 });
 for(const [body,key,code] of [
  [{operation:'recover_original_parent_once'},'wrong-secret','WORKER_UNAUTHORIZED'],
  [{operation:'recover_original_parent_once',package_id:packageId},secret,'EXACT_REQUEST_REQUIRED'],
  [{operation:'recover_expired_once'},secret,'EXACT_REQUEST_REQUIRED']
 ]){
  const response=await handler(recoveryRequest(body,key));
  assert.equal((await response.json()).status,code);
 }
 const wrongRoot=createDeliveryHandler({...hostedRecoveryOpts,
  testRootFolderId:driveId,recoverOriginalTestParent:()=>{calls++;throw Error('MUST_NOT_CALL');}
 });
 assert.equal((await wrongRoot(recoveryRequest({operation:'recover_original_parent_once'}))).status,503);
 assert.equal(calls,0);
});

test('hosted isolated TEST route sends only frozen server identities to existing atomic owner',async()=>{
 const calls=[];
 const handler=createDeliveryHandler({...hostedRecoveryOpts,
  recoverOriginalTestParent:async scope=>{
   calls.push(scope);
   assert.equal(scope.testPackageId,packageId);
   assert.equal(scope.testDestinationId,destinationId);
   assert.equal(scope.testRootId,root);
   assert.equal(scope.expectedEmail,scopeValue());
   assert.equal(scope.expectedDriveId,driveId);
   assert.equal(scope.makeRequestId(),uuid(98));
   assert.equal(typeof scope.ledger.recoverAndAcquireDispatch,'function');
   assert.equal(typeof scope.tokenProvider,'function');
   return {state:'ORIGINAL_TEST_PARENT_VERIFIED'};
  }
 });
 function scopeValue(){return 'operator@example.invalid';}
 const response=await handler(recoveryRequest({operation:'recover_original_parent_once'}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:'ORIGINAL_TEST_PARENT_VERIFIED'});
 assert.equal(calls.length,1);
});

test('hosted recovery masks lost or ambiguous coordinator results with no retry',async()=>{
 for(const cause of ['throw','wrong-result']){
  let calls=0;
  const handler=createDeliveryHandler({...hostedRecoveryOpts,
   recoverOriginalTestParent:async()=>{calls++;
    if(cause==='throw')throw Error('SIMULATED_ATOMIC_RESPONSE_LOSS');
    return {state:'UNCERTAIN'};
   }
  });
  const response=await handler(recoveryRequest({operation:'recover_original_parent_once'}));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{status:'ORIGINAL_TEST_RECOVERY_UNVERIFIED'});
  assert.equal(calls,1);
 }
});

test('unhosted coordinator refuses failed atomic commit before any provider continuation',async()=>{
 const r=rig(),calls=[];
 r.opts.ledger.recoverAndAcquireDispatch=async proof=>{
  calls.push('atomic-denied');
  assert.equal(proof.worker_id,workerId);
  assert.equal(proof.remote_folder_id,originalId);
  throw new DriveUncertain('ATOMIC_DISPATCH_OCCUPIED');
 };
 noContinuation(r);
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(87)
 }),isCode('ATOMIC_DISPATCH_OCCUPIED'));
 assert.deepEqual(calls,['atomic-denied']);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
});

test('unhosted coordinator cannot recover or dispatch again after lost atomic response',async()=>{
 const r=rig(),calls=[];
 r.opts.ledger.recoverAndAcquireDispatch=async proof=>{
  calls.push('atomic-uncertain');
  assert.equal(proof.worker_id,workerId);
  assert.equal(proof.remote_folder_id,originalId);
  throw Error('SIMULATED_ATOMIC_RESPONSE_LOSS');
 };
 noContinuation(r);
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(91)
 }),/SIMULATED_ATOMIC_RESPONSE_LOSS/);
 assert.deepEqual(calls,['atomic-uncertain']);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
});

test('wrong combined result never reaches Google or releases a permit',async()=>{
 for(const mutate of [r=>({...r,dispatch_id:uuid(99)}),
  r=>({...r,worker_id:uuid(99)}),r=>({...r,status:'ORIGINAL_TEST_LEASE_RESUMED'})]){
  const r=rig(),calls=[];
  r.opts.ledger.recoverAndAcquireDispatch=async proof=>{
   calls.push('atomic-reply');
   return mutate(atomicReceipt(proof));
  };
  noContinuation(r);
  await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
   ...r.opts,makeRequestId:()=>uuid(91)
  }),isCode('RECOVERY_CAS_CONFIRMATION_UNCERTAIN'));
  assert.deepEqual(calls,['atomic-reply']);
 }
});

test('crash after atomic commit before Google POST holds permit without replay',async()=>{
 const r=rig(),events=[];
 r.opts.ledger.recoverAndAcquireDispatch=async proof=>{
  events.push('atomic-committed');return atomicReceipt(proof);
 };
 r.opts.ledger.heartbeat=async()=>{
  events.push('heartbeat-failed');throw Error('SIMULATED_CRASH_AFTER_COMMIT');
 };
 r.opts.ledger.releaseDispatch=()=>{throw Error('MUST_NOT_RELEASE_UNCERTAIN_PERMIT');};
 for(const name of ['readParent','beginParentCreate','confirmParent']){
  r.opts.ledger[name]=()=>{throw Error('MUST_NOT_CREATE_AFTER_CRASH');};
 }
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(91)
 }),/SIMULATED_CRASH_AFTER_COMMIT/);
 assert.deepEqual(events,['atomic-committed','heartbeat-failed']);
 assert.equal(r.events.includes('/drive/v3/files/'+originalId),true);
 assert.equal(r.events.some(x=>x.includes('upload')),false);
});

const heldAttempt={
 state:'ORIGINAL_ATTEMPTED_PARENT_HELD',
 package_id:packageId,destination_id:destinationId,root_id:root,
 worker_id:workerId,generation:1,attempts:1,request_id:uuid(88),
 map_id:mapId,remote_folder_id:originalId,parent_remote_id:root,
 remote_name:'TEST ONLY - saved original location',drive_id:driveId,
 approved_sha256:sha,
 appProperties:{fwh_org:uuid(30),fwh_company:uuid(31),
   fwh_destination:destinationId,fwh_kind:'ADDRESS',fwh_key:sha}
};
function attemptedRig({snapshot=heldAttempt,remoteStatus=200,commitLost=false,
 releaseLost=false}={}){
 const events=[];
 const ledger={
  readAttemptedExactTestParent:async(p,d,r)=>{
   events.push('read-attempt');assert.deepEqual([p,d,r],[packageId,destinationId,root]);
   return structuredClone(snapshot);
  },
  commitAttemptedExactTestParent:async(scope,observed,proof)=>{
   events.push('atomic-confirm');
   assert.deepEqual(scope,{package_id:packageId,destination_id:destinationId,
    root_id:root,worker_id:workerId,generation:1,map_id:mapId,request_id:uuid(88)});
   assert.ok(Math.abs(Date.now()-Date.parse(observed))<5000);
   assert.deepEqual(proof,{id:originalId,parent:root,
    mime:'application/vnd.google-apps.folder',name:heldAttempt.remote_name,
    drive_id:driveId,trashed:false,sha256:null,size:null,
    appProperties:heldAttempt.appProperties});
   if(commitLost)throw Error('SIMULATED_LOST_COMMIT_RESPONSE');
   return {status:'ORIGINAL_TEST_PARENT_RECONCILED',package_id:packageId,
    worker_id:workerId,generation:1,map_id:mapId,remote_folder_id:originalId,
    dispatch_id:uuid(88),permit_held:true};
  },
  releaseDispatch:async(id)=>{
   events.push('release-original-permit');assert.equal(id,uuid(88));
   if(releaseLost)throw Error('SIMULATED_LOST_RELEASE_RESPONSE');
   return {released:true};
  }
 };
 const fetcher=async(url,init)=>{
  const u=new URL(url);
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(init.method??'GET','GET');
  assert.equal(init.redirect,'error');
  events.push(u.pathname);
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:scope,me:true,permissionId:'test-permission'}});
  if(u.pathname==='/drive/v3/files/'+root)
   return Response.json({id:root,trashed:false,
    mimeType:'application/vnd.google-apps.folder',driveId,
    capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/'+originalId){
   if(remoteStatus!==200)return Response.json({error:'redacted'},{status:remoteStatus});
   return Response.json({id:originalId,trashed:false,driveId,
    mimeType:'application/vnd.google-apps.folder',name:heldAttempt.remote_name,
    parents:[root],appProperties:heldAttempt.appProperties});
  }
  throw Error('UNEXPECTED_HTTP_REQUEST');
 };
 return {events,opts:{...args,ledger,
  tokenProvider:async()=>({accessToken:'disposable-test-access-0123456789012345',
    expiresInSeconds:3600}),fetcher}};
}
test('existing attempted original Google folder is GET-verified then atomically confirmed, no POST or new lease claim',async()=>{
 const r=attemptedRig();
 const result=await reconcileOriginalAttemptedTestParentOnce(r.opts);
 assert.equal(result.state,'ORIGINAL_TEST_PARENT_RECONCILED');
 assert.deepEqual(r.events,[
  'read-attempt','/drive/v3/about','/drive/v3/files/'+root,
  '/drive/v3/files/'+originalId,'atomic-confirm','release-original-permit']);
 assert.equal(r.events.some(x=>/POST|generate|new-lease|create/.test(x)),false);
});
test('changed attempted identity, missing Google folder or 403 stops before atomic CAS',async()=>{
 // Original worker comparison occurs inside the atomic DB audit guard.
 for(const change of [x=>x.state='RESERVED',
  x=>x.request_id=null,x=>x.remote_folder_id='wrong',
  x=>x.drive_id='foreign_drive_123456789',x=>x.attempts=2,
  x=>x.appProperties.fwh_destination=uuid(99)]){
  const s=structuredClone(heldAttempt);change(s);
  const r=attemptedRig({snapshot:s});
  await assert.rejects(()=>reconcileOriginalAttemptedTestParentOnce(r.opts),
   isCode('EXACT_TEST_ATTEMPTED_PARENT_CHANGED'));
  assert.deepEqual(r.events,['read-attempt']);
 }
 for(const code of [404,403,500]){
  const r=attemptedRig({remoteStatus:code});
  await assert.rejects(()=>reconcileOriginalAttemptedTestParentOnce(r.opts),
   e=>e instanceof DriveUncertain);
  assert.equal(r.events.includes('atomic-confirm'),false);
  assert.equal(r.events.includes('release-original-permit'),false);
 }
});
test('lost atomic confirmation response keeps the original held permit',async()=>{
 const r=attemptedRig({commitLost:true});
 await assert.rejects(()=>reconcileOriginalAttemptedTestParentOnce(r.opts),
  /SIMULATED_LOST_COMMIT_RESPONSE/);
 assert.equal(r.events.includes('atomic-confirm'),true);
 assert.equal(r.events.includes('release-original-permit'),false);
});
test('lost permit-release reply never reports successful reconciliation',async()=>{
 const r=attemptedRig({releaseLost:true});
 await assert.rejects(()=>reconcileOriginalAttemptedTestParentOnce(r.opts),
  /SIMULATED_LOST_RELEASE_RESPONSE/);
 assert.equal(r.events.filter(x=>x==='release-original-permit').length,1);
});
test('new hosted TEST reconciliation route is default OFF, no ID override, and fails closed',async()=>{
 const disabled=createDeliveryHandler({...hostedRecoveryOpts,testRecoveryEnabled:false});
 assert.equal((await disabled(recoveryRequest({
  operation:'reconcile_original_attempted_parent_once'}))).status,400);
 let calls=0;
 const handler=createDeliveryHandler({...hostedRecoveryOpts,
  reconcileOriginalTestParent:async()=>{calls++;return {state:'ORIGINAL_TEST_PARENT_RECONCILED'};}});
 for(const body of [
  {operation:'reconcile_original_attempted_parent_once',remote_id:originalId},
  {operation:'reconcile_original_attempted_parent_once',worker_id:workerId}
 ]){
  const res=await handler(recoveryRequest(body));
  assert.equal(res.status,400);
 }
 assert.equal((await handler(recoveryRequest({
  operation:'reconcile_original_attempted_parent_once'},'not-the-key'))).status,401);
 assert.equal(calls,0);
 const res=await handler(recoveryRequest({
  operation:'reconcile_original_attempted_parent_once'}));
 assert.equal(res.status,200);assert.equal(calls,1);
 const lost=createDeliveryHandler({...hostedRecoveryOpts,
  reconcileOriginalTestParent:async()=>{throw Error('SIMULATED_LOST_RPC');}});
 const blocked=await lost(recoveryRequest({
  operation:'reconcile_original_attempted_parent_once'}));
 assert.equal(blocked.status,503);
 assert.deepEqual(await blocked.json(),{status:'ORIGINAL_TEST_RECONCILIATION_UNVERIFIED'});
});

const childId='verified_workorder_child_0123456789';
const childName='work-order-00000000-0000-4000-8000-000000000011';
const childMap=uuid(77);
const childProperties={fwh_org:uuid(30),fwh_company:uuid(31),
 fwh_destination:destinationId,fwh_kind:'WORK_ORDER',fwh_key:uuid(11)};
const verifiedEvidence={id:originalId,parent:root,
 mime:'application/vnd.google-apps.folder',name:heldAttempt.remote_name,
 drive_id:driveId,trashed:false,sha256:null,size:null,
 appProperties:heldAttempt.appProperties};
const verifiedSnapshot={...heldAttempt,state:'ORIGINAL_VERIFIED_PARENT_EXPIRED',
 lease_until:new Date(Date.now()-30000).toISOString(),
 remote_evidence:verifiedEvidence};

function verifiedChildRig({snapshot=verifiedSnapshot,remoteStatus=200,
 resumeLost=false,reservationLost=false,createLost=false}={}){
 const events=[];let reserved=false,confirmed=false;
 const ledger={
  readVerifiedOriginalTestParent:async()=>{events.push('read-exact');return structuredClone(snapshot);},
  resumeVerifiedOriginalAndAcquireDispatch:async(scope,proof,observed,request)=>{
   events.push('atomic-acquire');
   assert.equal(scope.worker_id,workerId);
   assert.equal(scope.remote_folder_id,originalId);
   assert.equal(scope.lease_until,snapshot.lease_until);
   assert.equal(request,uuid(81));
   assert.ok(Math.abs(Date.now()-Date.parse(observed))<5000);
   assert.deepEqual(proof,verifiedEvidence);
   if(resumeLost)throw Error('LOST_ATOMIC_REPLY');
   return {status:'ORIGINAL_VERIFIED_PARENT_LEASE_AND_DISPATCH_ACQUIRED',
    package_id:packageId,worker_id:workerId,generation:1,map_id:mapId,
    remote_folder_id:originalId,dispatch_id:request,
    expires_at:new Date(Date.now()+120000).toISOString()};
  },
  heartbeat:async()=>{events.push('heartbeat');return {expires_at:new Date(Date.now()+120000).toISOString()};},
  readParent:async(pkg,worker,gen,kind)=>{
   events.push('read-parent');assert.equal(kind,'WORK_ORDER');
   return reserved?{exists:true,map_id:childMap,kind:'WORK_ORDER',
    remote_folder_id:childId,parent_remote_id:originalId,
    remote_name:childName,state:confirmed?'VERIFIED':'RESERVED',appProperties:childProperties}
    :{exists:false,kind:'WORK_ORDER'};
  },
  reserveParent:async(pkg,worker,gen,kind,id,parent)=>{
   events.push('reserve-child');
   assert.deepEqual([pkg,worker,gen,kind,id,parent],
    [packageId,workerId,1,'WORK_ORDER',childId,originalId]);
   reserved=true;
   if(reservationLost)throw Error('LOST_RESERVATION_REPLY');
   return {map_id:childMap,kind:'WORK_ORDER',remote_folder_id:id,
    parent_remote_id:parent,state:'RESERVED'};
  },
  beginParentCreate:async()=>{events.push('create-permit');
   return {state:'MAY_CREATE',map_id:childMap,file_id:childId,parent_id:originalId};},
  confirmParent:async()=>{events.push('commit-child');confirmed=true;return {state:'VERIFIED'};},
  releaseDispatch:async(id)=>{events.push('release-permit');assert.equal(id,uuid(81));return {released:true};}
 };
 const fetcher=async(url,init)=>{
  const u=new URL(url);events.push((init.method??'GET')+':'+u.pathname);
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(init.redirect,'error');
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:scope,me:true,permissionId:'test-permission'}});
  if(u.pathname==='/drive/v3/files/'+root)
   return Response.json({id:root,driveId,trashed:false,
    mimeType:'application/vnd.google-apps.folder',
    capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/'+originalId){
   if(remoteStatus!==200)return Response.json({error:'unavailable'},{status:remoteStatus});
   return Response.json({id:originalId,driveId,trashed:false,
    mimeType:'application/vnd.google-apps.folder',name:heldAttempt.remote_name,
    parents:[root],appProperties:heldAttempt.appProperties,
    capabilities:{canAddChildren:true}});
  }
  if(u.pathname==='/drive/v3/files/generateIds'){
   assert.equal(init.method??'GET','GET');return Response.json({ids:[childId]});
  }
  if(u.pathname==='/drive/v3/files'&&init.method==='POST'){
   assert.equal(reserved,true);if(createLost)throw Error('LOST_PROVIDER_CREATE_REPLY');
   return Response.json({id:childId});
  }
  if(u.pathname==='/drive/v3/files/'+childId)
   return Response.json({id:childId,driveId,trashed:false,
     mimeType:'application/vnd.google-apps.folder',name:childName,
     parents:[originalId],appProperties:childProperties,
     capabilities:{canAddChildren:true}});
  throw Error('UNEXPECTED_PROVIDER_OPERATION');
 };
 return {events,opts:{...args,ledger,fetcher,
  makeRequestId:()=>uuid(81),
  tokenProvider:async()=>({accessToken:'test-token-01234567890123456789',
    expiresInSeconds:3600})}};
}
test('verified original parent continues with SAME worker and only one preallocated WORK_ORDER POST',async()=>{
 const r=verifiedChildRig();
 const value=await continueOriginalVerifiedTestToWorkOrderOnce(r.opts);
 assert.equal(value.state,'ORIGINAL_TEST_WORK_ORDER_VERIFIED');
 const ev=r.events;
 assert.ok(ev.indexOf('atomic-acquire')<ev.indexOf('GET:/drive/v3/files/generateIds'));
 assert.ok(ev.indexOf('reserve-child')<ev.indexOf('POST:/drive/v3/files'));
 assert.ok(ev.indexOf('commit-child')<ev.indexOf('release-permit'));
 assert.equal(ev.filter(x=>x==='POST:/drive/v3/files').length,1);
 assert.equal(ev.filter(x=>x==='atomic-acquire').length,1);
});
test('verified original parent refuses unknown remote outcomes before dispatch or CREATE',async()=>{
 for(const status of [404,403,500]){
  const r=verifiedChildRig({remoteStatus:status});
  await assert.rejects(()=>continueOriginalVerifiedTestToWorkOrderOnce(r.opts),
   e=>e instanceof DriveUncertain);
  assert.equal(r.events.includes('atomic-acquire'),false);
 }
 for(const mutation of [x=>x.worker_id=null,x=>x.generation=2,
  x=>x.remote_folder_id='wrong',x=>x.state='RESERVED',
  x=>x.remote_evidence.drive_id='wrong']){
  const snap=structuredClone(verifiedSnapshot);mutation(snap);
  const r=verifiedChildRig({snapshot:snap});
  await assert.rejects(()=>continueOriginalVerifiedTestToWorkOrderOnce(r.opts),
   e=>e instanceof DriveUncertain);
  assert.equal(r.events.includes('atomic-acquire'),false);
 }
});
test('lost atomic or reservation acknowledgement never POSTs or releases permit',async()=>{
 for(const cfg of [{resumeLost:true},{reservationLost:true}]){
  const r=verifiedChildRig(cfg);
  await assert.rejects(()=>continueOriginalVerifiedTestToWorkOrderOnce(r.opts));
  assert.equal(r.events.includes('POST:/drive/v3/files'),false);
  assert.equal(r.events.includes('release-permit'),false);
 }
});
test('uncertain Google CREATE response leaves original dispatch held without retry',async()=>{
 const r=verifiedChildRig({createLost:true});
 await assert.rejects(()=>continueOriginalVerifiedTestToWorkOrderOnce(r.opts),
  isCode('PROVIDER_OUTCOME_UNCERTAIN'));
 assert.equal(r.events.filter(x=>x==='POST:/drive/v3/files').length,1);
 assert.equal(r.events.includes('release-permit'),false);
});
test('new WORK_ORDER hosted operation is default OFF, exact-only, and masks uncertainty',async()=>{
 const operation='continue_verified_original_wo_once';
 const disabled=createDeliveryHandler({...hostedRecoveryOpts,testRecoveryEnabled:false});
 assert.equal((await disabled(recoveryRequest({operation}))).status,400);
 let calls=0;
 const handler=createDeliveryHandler({...hostedRecoveryOpts,
  continueVerifiedOriginalTestWO:async()=>{calls++;return {state:'ORIGINAL_TEST_WORK_ORDER_VERIFIED'};}});
 for(const body of [{operation,worker_id:workerId},{operation,remote_id:childId}]){
  const r=await handler(recoveryRequest(body));assert.equal(r.status,400);
 }
 assert.equal((await handler(recoveryRequest({operation},'wrong-secret'))).status,401);
 assert.equal(calls,0);
 const ok=await handler(recoveryRequest({operation}));
 assert.equal(ok.status,200);assert.equal(calls,1);
 const lost=createDeliveryHandler({...hostedRecoveryOpts,
  continueVerifiedOriginalTestWO:async()=>{throw Error('LOSS_AFTER_GOOGLE');}});
 const failed=await lost(recoveryRequest({operation}));
 assert.equal(failed.status,503);
 assert.deepEqual(await failed.json(),{status:'ORIGINAL_TEST_WORK_ORDER_UNVERIFIED'});
});

const packagePhotoIds=[uuid(71),uuid(72)];
const packageRemoteIds=['saved_package_folder_0123456789','saved_photo_a_0123456789',
 'saved_photo_b_0123456789','saved_manifest_0123456789'];
const packagePlan=uuid(79),packageRequest=uuid(80);
const packageProps={fwh_package:packageId,fwh_manifest:sha};
const parentProof={...verifiedEvidence};
const woProof={id:childId,parent:originalId,name:childName,
 mime:'application/vnd.google-apps.folder',drive_id:driveId,
 trashed:false,sha256:null,size:null,appProperties:childProperties};
function packageRig({lost=null,remoteStatus=200,snapshotChange=null}={}){
 const events=[];let reserved=false,verified=false;
 const snap={state:'ORIGINAL_VERIFIED_WORK_ORDER_EXPIRED',
  package_id:packageId,destination_id:destinationId,root_id:root,
  worker_id:workerId,generation:1,attempts:1,map_id:childMap,
  approved_sha256:sha,lease_until:new Date(Date.now()-30000).toISOString(),
  remote_folder_id:childId,parent_remote_id:originalId,
  remote_name:childName,parent_name:heldAttempt.remote_name,
  drive_id:driveId,appProperties:childProperties,
  parent_appProperties:heldAttempt.appProperties,
  remote_evidence:woProof,parent_evidence:parentProof,
  selected_photos:packagePhotoIds.map((id,i)=>({
   photo_id:id,observed_sha256:(i?'c':'b').repeat(64),observed_size:i?256:128
  }))};
 if(snapshotChange)snapshotChange(snap);
 const plan=()=>({package_id:packageId,plan_id:packagePlan,kind:'FOLDER',
  parent_kind:'WORK_ORDER',work_order_id:uuid(11),
  file_id:packageRemoteIds[0],parent_id:childId,name:'package-'+packageId,
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,
  appProperties:packageProps,state:verified?'VERIFIED':'PREALLOCATED'});
 const ledger={
  readVerifiedOriginalTestWOForPackage:async()=>{events.push('read');return structuredClone(snap);},
  resumeVerifiedWOAndAcquirePackageDispatch:async(s,proof,at,request)=>{
   events.push('CAS');assert.equal(s.worker_id,workerId);
   assert.equal(s.lease_until,snap.lease_until);
   assert.deepEqual(proof,woProof);assert.equal(request,packageRequest);
   if(lost==='cas')throw Error('LOST_CAS');
   return {status:'ORIGINAL_VERIFIED_WO_LEASE_AND_DISPATCH_ACQUIRED',
    package_id:packageId,worker_id:workerId,generation:1,map_id:childMap,
    remote_folder_id:childId,dispatch_id:request,
    expires_at:new Date(Date.now()+120000).toISOString()};
  },
  heartbeat:async()=>{events.push('beat');return {ok:true};},
  readParent:async()=>{events.push('parent');return {exists:true,
   kind:'WORK_ORDER',state:'VERIFIED',map_id:childMap,
   remote_folder_id:childId,parent_remote_id:originalId};},
  nextReservedItem:async()=>{events.push('next');return reserved
   ?{state:'FOLDER',plan_id:packagePlan}:{state:'UNRESERVED'};},
  reserveBatch:async(p,w,g,folder,parent,photos,manifest)=>{
   events.push('reserve');assert.deepEqual([p,w,g,folder,parent,manifest],
    [packageId,workerId,1,packageRemoteIds[0],childId,packageRemoteIds[3]]);
   assert.deepEqual(photos,packagePhotoIds.map((photo_id,i)=>({
    photo_id,file_id:packageRemoteIds[i+1]})));
   reserved=true;if(lost==='reserve')throw Error('LOST_RESERVATION');
   return {reserved:true,package_id:p,folder_id:folder,
    manifest_id:manifest,reserved_count:4};
  },
  forLease:()=>({
   heartbeat:async()=>{events.push('leasebeat');return {ok:true};},
   getFolderPlan:async()=>{events.push('getPlan');return plan();},
   beginFolderCreate:async()=>{events.push('begin');return {
    state:'MAY_CREATE',plan_id:packagePlan,file_id:packageRemoteIds[0],parent_id:childId};},
   confirmFolder:async()=>{events.push('confirm');verified=true;return {state:'VERIFIED'};}
  }),
  releaseDispatch:async id=>{events.push('release');assert.equal(id,packageRequest);return {released:true};}
 };
 const fetcher=async(url,init)=>{
  const u=new URL(url),method=init.method??'GET';events.push(method+':'+u.pathname);
  assert.equal(u.origin,'https://www.googleapis.com');
  if(u.pathname==='/drive/v3/about')
   return Response.json({user:{emailAddress:scope,me:true,permissionId:'test-permission'}});
  const files={
   [root]:{id:root,driveId,trashed:false,mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}},
   [originalId]:{id:originalId,driveId,trashed:false,name:heldAttempt.remote_name,
    mimeType:'application/vnd.google-apps.folder',parents:[root],
    appProperties:heldAttempt.appProperties,capabilities:{canAddChildren:true}},
   [childId]:{id:childId,driveId,trashed:false,name:childName,
    mimeType:'application/vnd.google-apps.folder',parents:[originalId],
    appProperties:childProperties,capabilities:{canAddChildren:true}},
   [packageRemoteIds[0]]:{id:packageRemoteIds[0],driveId,trashed:false,
    name:'package-'+packageId,mimeType:'application/vnd.google-apps.folder',
    parents:[childId],appProperties:packageProps}
  };
  if(u.pathname.startsWith('/drive/v3/files/') && !u.pathname.endsWith('generateIds')){
   const id=u.pathname.split('/').at(-1);
   if(id===childId&&remoteStatus!==200)
    return Response.json({error:'unavailable'},{status:remoteStatus});
   return Response.json(files[id]??{error:'unknown'},{status:files[id]?200:404});
  }
  if(u.pathname==='/drive/v3/files/generateIds'){
   assert.equal(u.searchParams.get('count'),'4');
   return Response.json({ids:packageRemoteIds});
  }
  if(u.pathname==='/drive/v3/files'&&method==='POST'){
   assert.equal(reserved,true);
   if(lost==='post')throw Error('LOST_GOOGLE_POST');
   return Response.json({id:packageRemoteIds[0]});
  }
  throw Error('Unexpected provider call: '+u.pathname);
 };
 return {events,opts:{...args,ledger,fetcher,makeRequestId:()=>packageRequest,
  tokenProvider:async()=>({accessToken:'test-token-01234567890123456789',expiresInSeconds:3600})}};
}
test('verified original WORK_ORDER reserves all immutable IDs before one PACKAGE POST',async()=>{
 const r=packageRig(),res=await continueOriginalVerifiedTestToPackageOnce(r.opts);
 assert.equal(res.state,'ORIGINAL_TEST_PACKAGE_FOLDER_VERIFIED');
 const e=r.events;
 assert.ok(e.indexOf('CAS')<e.indexOf('GET:/drive/v3/files/generateIds'));
 assert.ok(e.indexOf('reserve')<e.indexOf('POST:/drive/v3/files'));
 assert.ok(e.indexOf('confirm')<e.indexOf('release'));
 assert.equal(e.filter(x=>x==='POST:/drive/v3/files').length,1);
});
test('uncertain CAS/reservation/Google provider response stops, keeps permit, never retries',async()=>{
 for(const lost of ['cas','reserve','post']){
  const r=packageRig({lost});
  await assert.rejects(()=>continueOriginalVerifiedTestToPackageOnce(r.opts));
  assert.equal(r.events.includes('release'),false);
  assert.equal(r.events.filter(x=>x==='POST:/drive/v3/files').length,lost==='post'?1:0);
 }
});
test('foreign or unverified WORK_ORDER evidence denies any package Google CREATE',async()=>{
 for(const change of [s=>s.worker_id=uuid(99),s=>s.state='USED',
  s=>s.selected_photos.pop(),s=>s.remote_folder_id='wrong',
  s=>s.parent_evidence.name='changed']){
  const r=packageRig({snapshotChange:change});
  await assert.rejects(()=>continueOriginalVerifiedTestToPackageOnce(r.opts));
  assert.equal(r.events.includes('CAS'),false);
 }
 for(const remoteStatus of [403,404,500]){
  const r=packageRig({remoteStatus});
  await assert.rejects(()=>continueOriginalVerifiedTestToPackageOnce(r.opts));
  assert.equal(r.events.includes('CAS'),false);
 }
});
test('one-time PACKAGE TEST handler is default OFF, private-secret only, exact body',async()=>{
 const operation='continue_verified_original_package_once';
 const disabled=createDeliveryHandler({...hostedRecoveryOpts,testRecoveryEnabled:false});
 assert.equal((await disabled(recoveryRequest({operation}))).status,400);
 let calls=0;
 const handler=createDeliveryHandler({...hostedRecoveryOpts,
  continueVerifiedOriginalTestPackage:async()=>{calls++;return {state:'ORIGINAL_TEST_PACKAGE_FOLDER_VERIFIED'};}});
 assert.equal((await handler(recoveryRequest({operation,worker_id:workerId}))).status,400);
 assert.equal((await handler(recoveryRequest({operation},'wrong-secret'))).status,401);
 assert.equal(calls,0);
 assert.equal((await handler(recoveryRequest({operation}))).status,200);
 assert.equal(calls,1);
 const lost=createDeliveryHandler({...hostedRecoveryOpts,
  continueVerifiedOriginalTestPackage:async()=>{throw Error('LOST_PACKAGE_REPLY');}});
 const response=await lost(recoveryRequest({operation}));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:'ORIGINAL_TEST_PACKAGE_FOLDER_UNVERIFIED'});
});
