import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExpiredReservedParent,resumeInspectedExpiredTestLease,
 recoverAndContinueOriginalTestParentOnce}
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
 remote_folder_id:originalId,dispatch_id:proof.dispatch_id,
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
  assert.equal(proof.dispatch_id,uuid(89));
  assert.ok(Date.now()-Date.parse(proof.observed_at)<5000);
  return atomicReceipt(proof);
 };
 const result=await resumeInspectedExpiredTestLease({
  ...r.opts,makeRequestId:()=>uuid(88),makeDispatchId:()=>uuid(89)
 });
 assert.equal(result.state,'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED');
 assert.equal(result.dispatch_id,uuid(89));
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
  request_id:uuid(90),dispatch_id:uuid(91)
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
 assert.equal(body.p_dispatch,uuid(91));
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
  ...r.opts,makeRequestId:()=>uuid(87),makeDispatchId:()=>uuid(88)
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
  ...r.opts,makeRequestId:()=>uuid(91),makeDispatchId:()=>uuid(92)
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
   ...r.opts,makeRequestId:()=>uuid(91),makeDispatchId:()=>uuid(92)
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
  ...r.opts,makeRequestId:()=>uuid(91),makeDispatchId:()=>uuid(92)
 }),/SIMULATED_CRASH_AFTER_COMMIT/);
 assert.deepEqual(events,['atomic-committed','heartbeat-failed']);
 assert.equal(r.events.includes('/drive/v3/files/'+originalId),true);
 assert.equal(r.events.some(x=>x.includes('upload')),false);
});
