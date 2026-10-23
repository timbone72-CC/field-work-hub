import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectExpiredReservedParent}
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
 await assert.rejects(()=>ledger.readExpiredReservation(),
  isCode('SERVICE_RPC_UNAVAILABLE'));
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,
  '/rest/v1/rpc/service_read_expired_test_delivery_reservation');
 assert.deepEqual(JSON.parse(calls[0].opts.body),{});
});
test('hosted worker has no recovery write route before the governed SQL gate',async()=>{
 const handler=createDeliveryHandler({enabled:true,workerSecret:secret});
 const response=await handler(new Request('https://worker.invalid',{
  method:'POST',headers:{'content-type':'application/json',
   'x-fwh-delivery-secret':secret},
  body:JSON.stringify({operation:'recover_expired_once'})
 }));
 assert.equal(response.status,400);
 assert.deepEqual(await response.json(),{status:'EXACT_REQUEST_REQUIRED'});
});
