import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTrustedDeliveryOneStep,prepareTrustedDelivery,continueTrustedPackageFolder}
 from '../../supabase/functions/client-delivery/worker-runtime.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const driveId='drive_'+'c'.repeat(24),rootId='root_'+'d'.repeat(24);
const claim={claimed:true,package_id:uuid(3),destination_id:uuid(4),
 generation:1,approved_sha256:'a'.repeat(64),
 manifest:{package_id:uuid(3),destination_id:uuid(4),
 destination_root:rootId,review_policy_revision:uuid(5),
 selected_photos:[{photo_id:uuid(7),observed_sha256:'a'.repeat(64),observed_size:200000}]}};
const scope='office@example.invalid';
function rig({oauthFail=false,wrongAccount=false,noWrite=false}={}){
 const events=[];
 const tokenProvider=async()=>{
   events.push('oauth');
   if(oauthFail)throw Error('private refresh failed');
   return {accessToken:'private-token-not-for-client',expiresInSeconds:3600};
 };
 const ledger={
   claim:async()=>{events.push('claim');return claim;},
   heartbeat:async()=>{events.push('heartbeat');},
   readParent:async()=>{events.push('readParent');return {exists:false,kind:'ADDRESS'};},
   reserveParent:async(_pkg,_worker,_gen,kind,id,parent)=>{
     events.push('reserveParent');return {kind,remote_folder_id:id,parent_remote_id:parent,state:'RESERVED'};},
   reserve:async()=>{events.push('reserve');}
 };
 const fetcher=async(url,opts)=>{
   const u=new URL(url);events.push(u.pathname);
   assert.equal(u.origin,'https://www.googleapis.com');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.headers.Authorization,'Bearer private-token-not-for-client');
   if(u.pathname==='/drive/v3/about')return Response.json({
    user:{emailAddress:wrongAccount?'wrong@example.invalid':scope,me:true,permissionId:'perm_abc123'}});
   if(u.pathname==='/drive/v3/files/'+rootId)return Response.json({
    id:rootId,mimeType:'application/vnd.google-apps.folder',
    driveId,trashed:false,capabilities:{canAddChildren:!noWrite}});
   if(u.pathname==='/drive/v3/files/generateIds')return Response.json({
    ids:['generated_'+'a'.repeat(20)]});
   throw Error('Unexpected network call '+u.pathname);
 };
 return {events,tokenProvider,ledger,fetcher};
}
const args={workerId:uuid(1),expectedEmail:scope,expectedDriveId:driveId};
test('refresh failure never claims outbox or sends a Google request',async()=>{
 const r=rig({oauthFail:true});
 await assert.rejects(()=>prepareTrustedDelivery({...args,...r}),e=>
   e instanceof DriveUncertain&&e.code==='WORKSPACE_AUTHORIZATION_REQUIRED');
 assert.deepEqual(r.events,['oauth']);
});
test('wrong Workspace identity or unwritable destination never allocates or uploads bytes',async()=>{
 for(const mode of [{wrongAccount:true},{noWrite:true}]){
  const r=rig(mode);
  await assert.rejects(()=>prepareTrustedDelivery({...args,...r}),DriveUncertain);
  assert.equal(r.events.includes('/drive/v3/files/generateIds'),false);
  assert.equal(r.events.includes('reserve'),false);
 }
});
test('valid OAuth reserves ADDRESS parent only until real folder verification',async()=>{
 const r=rig();
 const data=await prepareTrustedDelivery({...args,...r});
 assert.deepEqual(data,{claimed:true,package_id:uuid(3),generation:1,
  reserved_count:1,next_parent_kind:'ADDRESS',
  ready_for_provider_reconciliation:true,provider_writes_performed:false});
 assert.deepEqual(r.events,['oauth','claim','/drive/v3/about','/drive/v3/files/'+rootId,
  'heartbeat','readParent','heartbeat','/drive/v3/files/generateIds',
  'heartbeat','reserveParent']);
 assert.equal(r.events.includes('reserve'),false);
 assert.equal(JSON.stringify(data).includes('private-token'),false);
});

const folderId='folder_'+'e'.repeat(24), woId='wo_'+'f'.repeat(24);
function folderRig(state='ATTEMPTED'){
 const events=[],plan={package_id:uuid(3),plan_id:uuid(9),kind:'FOLDER',
  parent_kind:'WORK_ORDER',file_id:folderId,parent_id:woId,
  name:'package-'+uuid(3),work_order_id:uuid(8),
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,
  appProperties:{fwh_package:uuid(3),fwh_manifest:'a'.repeat(64)},state};
 const scoped={
  heartbeat:async()=>{events.push('heartbeat');},
  getFolderPlan:async()=>{events.push('plan');return plan;},
  beginFolderCreate:async()=>{events.push('begin');return {state:'MAY_CREATE',
   plan_id:plan.plan_id,file_id:plan.file_id,parent_id:plan.parent_id};},
  confirmFolder:async(_plan,_worker,_gen,proof)=>{
   events.push('confirm');assert.equal(proof.id,folderId);
   assert.equal(proof.parent,woId);assert.equal(proof.drive_id,driveId);}
 };
 const ledger={forLease:()=>scoped};
 const fetcher=async(url,opts)=>{
  const u=new URL(url);events.push(opts.method??'GET');
  assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(opts.headers.Authorization,'Bearer private-token-not-for-client');
  if(u.pathname==='/drive/v3/about')return Response.json({
   user:{emailAddress:scope,me:true,permissionId:'perm_abc123'}});
  if(u.pathname==='/drive/v3/files/'+folderId)return Response.json({
   id:folderId,name:plan.name,driveId,trashed:false,
   mimeType:plan.mime,parents:[woId],appProperties:plan.appProperties});
  if(u.pathname==='/drive/v3/files/'+woId)return Response.json({
   id:woId,driveId,trashed:false,mimeType:plan.mime,
   capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files'&&opts.method==='POST')return Response.json({
   id:folderId});
  throw Error('unexpected endpoint');
 };
 const input={workerId:uuid(1),packageId:uuid(3),planId:uuid(9),
  generation:1,expectedEmail:scope,expectedDriveId:driveId,
  tokenProvider:async()=>({accessToken:'private-token-not-for-client',expiresInSeconds:3600}),
  ledger,fetcher};
 return {events,input};
}
test('existing attempted folder uses independent GET, never repeats provider POST',async()=>{
 const r=folderRig('ATTEMPTED');
 const result=await continueTrustedPackageFolder(r.input);
 assert.equal(result.state,'FOLDER_VERIFIED');
 assert.equal(r.events.includes('POST'),false);
 assert.equal(r.events.includes('begin'),false);
 assert.equal(r.events.includes('confirm'),true);
});
test('first package folder create requires journal begin, then independent GET',async()=>{
 const r=folderRig('PREALLOCATED');
 const result=await continueTrustedPackageFolder(r.input);
 assert.equal(result.state,'FOLDER_VERIFIED');
 const a=r.events.indexOf('begin'),p=r.events.indexOf('POST'),v=r.events.indexOf('confirm');
 assert.ok(a>=0&&p>a&&v>p);
});
test('racing recorded folder attempt verifies original ID without repeating POST',async()=>{
 const r=folderRig('PREALLOCATED');
 const original=r.input.ledger.forLease;
 r.input.ledger.forLease=(...args)=>{
  const scoped=original(...args);
  return {...scoped,beginFolderCreate:async()=>{
   r.events.push('begin');
   return {state:'VERIFY_EXISTING',plan_id:uuid(9),file_id:folderId,parent_id:woId};
  }};
 };
 const result=await continueTrustedPackageFolder(r.input);
 assert.equal(result.state,'FOLDER_VERIFIED');
 assert.equal(r.events.includes('begin'),true);
 assert.equal(r.events.includes('POST'),false);
 assert.equal(r.events.includes('confirm'),true);
});
test('wrong current OAuth identity refuses folder write before lease continuation',async()=>{
 const r=folderRig();
 r.input.expectedEmail='different@example.invalid';
 await assert.rejects(()=>continueTrustedPackageFolder(r.input),e=>
  e instanceof DriveUncertain&&e.code==='WORKSPACE_ACCOUNT_MISMATCH');
 assert.equal(r.events.includes('POST'),false);
 assert.equal(r.events.includes('plan'),false);
});


test('original-lease recovery refuses expired/unknown states without OAuth or claim',async()=>{
 for(const state of ['BLOCKED_UNCERTAIN','malformed']){
  const events=[];
  const ledger={readActiveLease:async()=>{events.push('read');return {state};},
    claim:async()=>{events.push('claim');return claim;},
    heartbeat:async()=>{events.push('heartbeat');}};
  const runner=()=>advanceTrustedDeliveryOneStep({
   ledger,tokenProvider:async()=>{events.push('oauth');return {}},
   makeWorkerId:()=>uuid(1),expectedEmail:scope,expectedDriveId:driveId
  });
  await assert.rejects(runner,e=>e instanceof DriveUncertain
   &&e.code===(state==='BLOCKED_UNCERTAIN'
     ?'EXPIRED_DELIVERY_REQUIRES_RECONCILIATION':'ORIGINAL_LEASE_READ_UNCERTAIN'));
  assert.deepEqual(events,['read']);
 }
});
test('malformed recovered identity cannot be swapped into a new claim',async()=>{
 const events=[],ledger={
  readActiveLease:async()=>{events.push('read');return {
   state:'ACTIVE',package_id:uuid(3),worker_id:'untrusted',
   generation:1,destination_id:uuid(4),approved_sha256:'a'.repeat(64),
   manifest:claim.manifest};},
  claim:async()=>{events.push('claim');return claim;},
  heartbeat:async()=>{events.push('heartbeat');}};
 await assert.rejects(()=>advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:async()=>{events.push('oauth');return {}},
  makeWorkerId:()=>uuid(99),expectedEmail:scope,expectedDriveId:driveId
 }),e=>e instanceof DriveUncertain&&e.code==='ORIGINAL_LEASE_READ_UNCERTAIN');
 assert.deepEqual(events,['read']);
});
test('new wakeup with empty outbox does not allocate Drive IDs or create a lease',async()=>{
 const events=[],ledger={
  readActiveLease:async()=>{events.push('read');return {state:'NONE'};},
  claim:async()=>{events.push('claim');return {claimed:false};},
  heartbeat:async()=>{events.push('heartbeat');},
  readParent:async()=>{throw Error('NO_EMPTY_QUEUE_PARENT_READ');},
  reserveParent:async()=>{throw Error('NO_EMPTY_QUEUE_RESERVATION');},
  reserve:async()=>{throw Error('NO_EMPTY_QUEUE_FILE_RESERVATION');}};
 const result=await advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:async()=>{events.push('oauth');
   return {accessToken:'private-token-not-for-client',expiresInSeconds:3600};},
  makeWorkerId:()=>uuid(1),expectedEmail:scope,expectedDriveId:driveId,
  fetcher:async()=>{events.push('provider');throw Error('unexpected');}
 });
 assert.deepEqual(result,{state:'NO_ELIGIBLE_PACKAGES'});
 assert.deepEqual(events,['read','oauth','claim']);
});
test('restart uses original active lease and GET-reconciles attempted folder without second POST',async()=>{
 const events=[],mapId=uuid(11),folderId='saved_'+'a'.repeat(24);
 const props={fwh_org:uuid(12),fwh_company:uuid(13),
  fwh_destination:claim.destination_id,fwh_kind:'ADDRESS',fwh_key:uuid(14)};
 const map={exists:true,map_id:mapId,kind:'ADDRESS',remote_folder_id:folderId,
  parent_remote_id:rootId,remote_name:'address-test',state:'ATTEMPTED',
  appProperties:props};
 const original={state:'ACTIVE',package_id:claim.package_id,worker_id:uuid(1),
  generation:claim.generation,destination_id:claim.destination_id,
  approved_sha256:claim.approved_sha256,manifest:claim.manifest};
 const ledger={
  readActiveLease:async()=>{events.push('read-active');return original;},
  claim:async()=>{throw Error('MUST NOT CLAIM DIFFERENT LEASE');},
  heartbeat:async(pkg,worker,gen)=>{
   events.push('heartbeat');assert.equal(pkg,claim.package_id);
   assert.equal(worker,uuid(1));assert.equal(gen,1);},
  readParent:async()=>{events.push('read-parent');return map;},
  confirmParent:async(_pkg,_worker,_gen,id,proof)=>{
   events.push('confirm');assert.equal(id,mapId);assert.equal(proof.id,folderId);},
  beginParentCreate:async()=>{throw Error('MUST NOT RECREATE');},
  reserveParent:async()=>{throw Error('MUST NOT RESERVE NEW ID');},
  reserve:async()=>{throw Error('MUST NOT RESERVE FILE');}
 };
 const fetcher=async(url,opts)=>{
  const u=new URL(url);
  events.push((opts.method||'GET')+' '+u.pathname);
  if(u.pathname==='/drive/v3/about')return Response.json({
   user:{emailAddress:scope,me:true,permissionId:'perm_abc123'}});
  if(u.pathname==='/drive/v3/files/'+rootId)return Response.json({
   id:rootId,mimeType:'application/vnd.google-apps.folder',
   driveId,trashed:false,capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/'+folderId)return Response.json({
   id:folderId,name:map.remote_name,driveId,parents:[rootId],
   mimeType:'application/vnd.google-apps.folder',trashed:false,
   appProperties:props});
  throw Error('Unexpected provider operation '+u.pathname);
 };
 const result=await advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:async()=>({accessToken:'private-token-not-for-client',
   expiresInSeconds:3600}),makeWorkerId:()=>{throw Error('NO NEW WORKER');},
  expectedEmail:scope,expectedDriveId:driveId,fetcher});
 assert.deepEqual(result,{state:'PARENT_STEP_VERIFIED'});
 assert.ok(events.includes('confirm'));
 assert.equal(events.some(x=>x.startsWith('POST /drive/')),false);
 assert.equal(events.some(x=>x.includes('generateIds')),false);
});
