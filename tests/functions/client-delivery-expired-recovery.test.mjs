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
test('one-use trusted recovery calls fenced CAS only after same-ID Google 404',async()=>{
 const r=rig(),savedCalls=[];
 r.opts.ledger.resumeExpiredReservation=async input=>{
  savedCalls.push(input);
  assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
   '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
  assert.equal(input.package_id,packageId);
  assert.equal(input.destination_id,destinationId);
  assert.equal(input.root_id,root);
  assert.equal(input.worker_id,workerId);
  assert.equal(input.generation,1);
  assert.equal(input.map_id,mapId);
  assert.equal(input.remote_folder_id,originalId);
  assert.equal(input.lease_until,saved.lease_until);
  assert.equal(input.request_id,uuid(88));
  assert.ok(Date.now()-Date.parse(input.observed_at)<5000);
  return {status:'ORIGINAL_TEST_LEASE_RESUMED',
   package_id:packageId,worker_id:workerId,generation:1,map_id:mapId,
   remote_folder_id:originalId,expires_at:new Date(Date.now()+120000).toISOString()};
 };
 const result=await resumeInspectedExpiredTestLease({
  ...r.opts,makeRequestId:()=>uuid(88)
 });
 assert.equal(result.state,'ORIGINAL_TEST_LEASE_RESUMED');
 assert.equal(savedCalls.length,1);
 assert.equal(r.events.some(x=>/upload|generateIds|POST/.test(x)),false);
});
test('ambiguous or wrong-ID provider responses NEVER trigger recovery CAS',async()=>{
 for(const remoteStatus of [200,401,403,500]){
  const r=rig({remoteStatus});let calls=0;
  r.opts.ledger.resumeExpiredReservation=()=>{calls++;throw Error('forbidden CAS');};
  await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
  assert.equal(calls,0);
 }
 const r=rig({snapshot:{...saved,lease_until:new Date(Date.now()+120000).toISOString()}});
 let calls=0;
 r.opts.ledger.resumeExpiredReservation=()=>{calls++;throw Error('forbidden CAS');};
 await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
 assert.equal(calls,0);
});
test('lost SQL CAS response never triggers second recovery or original-ID replacement',async()=>{
 const r=rig();let calls=0;
 r.opts.ledger.resumeExpiredReservation=async()=>{calls++;throw Error('network lost');};
 await assert.rejects(()=>resumeInspectedExpiredTestLease(r.opts));
 assert.equal(calls,1);
});
test('recovery CAS is one exact service RPC, no generic claim or client authority',async()=>{
 const seen=[];
 const {ledger}=(()=>({
  ledger:createServiceLedger({url:'https://fwh-test.supabase.co',
   serviceRoleJwt:'header.payload.signature',
   fetcher:async(url,opts)=>{seen.push({url,opts});return Response.json({status:'UNCERTAIN'});}})
 }))();
 await ledger.resumeExpiredReservation({
  package_id:packageId,destination_id:destinationId,root_id:root,
  worker_id:workerId,generation:1,map_id:mapId,remote_folder_id:originalId,
  lease_until:saved.lease_until,observed_at:new Date().toISOString(),
  request_id:uuid(90)});
 assert.equal(seen.length,1);
 assert.equal(new URL(seen[0].url).pathname,
  '/rest/v1/rpc/service_resume_exact_test_expired_delivery');
 const body=JSON.parse(seen[0].opts.body);
 assert.equal(body.p_root,root);
 assert.equal(body.p_worker,workerId);
 assert.equal(body.p_remote_id,originalId);
 assert.equal(body.p_probe_result,'GOOGLE_FILE_ID_NOT_FOUND');
 assert.equal(body.p_request,uuid(90));
 assert.equal(seen[0].opts.headers.Authorization,'Bearer header.payload.signature');
});
test('hosted worker rejects all unapproved recovery-write operations',async()=>{
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

test('unhosted one-shot coordinator never starts a provider write if durable dispatch is denied after CAS',async()=>{
 const r=rig(),events=[];
 r.opts.ledger.resumeExpiredReservation=async proof=>{
  events.push('recovery-cas');
  assert.equal(proof.worker_id,workerId);
  assert.equal(proof.remote_folder_id,originalId);
  return {status:'ORIGINAL_TEST_LEASE_RESUMED',
   package_id:packageId,worker_id:workerId,generation:1,map_id:mapId,
   remote_folder_id:originalId,expires_at:new Date(Date.now()+120000).toISOString()};
 };
 r.opts.ledger.acquireDispatch=async req=>{
  events.push('dispatch-denied');
  assert.equal(req,uuid(88));
  return {acquired:false};
 };
 for(const name of ['releaseDispatch','heartbeat','readParent','beginParentCreate','confirmParent']){
  r.opts.ledger[name]=()=>{throw Error('NO_PROVIDER_CONTINUATION_AFTER_DISPATCH_DENIAL');};
 }
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(87),makeDispatchId:()=>uuid(88)
 }),isCode('DISPATCH_PERMIT_UNAVAILABLE'));
 assert.deepEqual(events,['recovery-cas','dispatch-denied']);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
 // Exposes a remaining orchestration gap: the one-use recovery was consumed
 // before the dispatch reservation, so this cannot be treated as a PASS for
 // recover-and-continue atomicity or as authority for an automatic retry.
});

test('unhosted coordinator stops without dispatch or provider continuation when recovery CAS response is lost',async()=>{
 const r=rig(),calls=[];
 r.opts.ledger.resumeExpiredReservation=async proof=>{
  calls.push('cas-uncertain');
  assert.equal(proof.worker_id,workerId);
  assert.equal(proof.remote_folder_id,originalId);
  throw Error('SIMULATED_RECOVERY_CAS_RESPONSE_LOSS');
 };
 for(const name of ['acquireDispatch','releaseDispatch','heartbeat',
  'readParent','beginParentCreate','confirmParent']){
  r.opts.ledger[name]=()=>{throw Error('FORBIDDEN_STEP_AFTER_UNCERTAIN_RECOVERY');};
 }
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(91),makeDispatchId:()=>uuid(92)
 }),/SIMULATED_RECOVERY_CAS_RESPONSE_LOSS/);
 assert.deepEqual(calls,['cas-uncertain']);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
 // A lost CAS reply might follow an actual commit. No blind second CAS.
});

test('unhosted coordinator stops all provider work on ambiguous dispatch response after one recovery',async()=>{
 const r=rig(),calls=[];
 r.opts.ledger.resumeExpiredReservation=async proof=>{
  calls.push('cas-confirmed');
  assert.equal(proof.request_id,uuid(93));
  return {status:'ORIGINAL_TEST_LEASE_RESUMED',
   package_id:packageId,worker_id:workerId,generation:1,map_id:mapId,
   remote_folder_id:originalId,expires_at:new Date(Date.now()+120000).toISOString()};
 };
 r.opts.ledger.acquireDispatch=async request=>{
  calls.push('dispatch-uncertain');
  assert.equal(request,uuid(94));
  throw Error('SIMULATED_DISPATCH_RESPONSE_LOSS');
 };
 for(const name of ['releaseDispatch','heartbeat','readParent',
  'beginParentCreate','confirmParent']){
  r.opts.ledger[name]=()=>{throw Error('FORBIDDEN_STEP_AFTER_UNCERTAIN_DISPATCH');};
 }
 await assert.rejects(()=>recoverAndContinueOriginalTestParentOnce({
  ...r.opts,makeRequestId:()=>uuid(93),makeDispatchId:()=>uuid(94)
 }),/SIMULATED_DISPATCH_RESPONSE_LOSS/);
 assert.deepEqual(calls,['cas-confirmed','dispatch-uncertain']);
 assert.deepEqual(r.events,['exact-read','oauth','/drive/v3/about',
  '/drive/v3/files/'+root,'/drive/v3/files/'+originalId]);
 // Neither an uncertain permit nor a consumed recovery can authorize retry.
});
