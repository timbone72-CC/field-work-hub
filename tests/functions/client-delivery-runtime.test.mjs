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
  nextReservedItem:async()=>{events.push('next');return {state:'UNRESERVED'};},
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

test('first scheduler wakeup creates only one server-reserved folder after attempt journal',async()=>{
 const events=[],folderId='generated_'+'c'.repeat(24),mapId=uuid(19);
 const props={fwh_org:uuid(12),fwh_company:uuid(13),
  fwh_destination:claim.destination_id,fwh_kind:'ADDRESS',fwh_key:uuid(14)};
 let map=null;
 const ledger={
  readActiveLease:async()=>{events.push('read-active');return {state:'NONE'};},
  claim:async worker=>{events.push('claim');assert.equal(worker,uuid(1));return claim;},
  heartbeat:async()=>{events.push('heartbeat');},
  readParent:async()=>{events.push('read-parent');return map??{exists:false,kind:'ADDRESS'};},
  reserveParent:async(_pkg,_worker,_gen,kind,id,parent)=>{
   events.push('reserve-parent');assert.equal(kind,'ADDRESS');
   assert.equal(id,folderId);assert.equal(parent,rootId);
   map={exists:true,map_id:mapId,kind,remote_folder_id:id,
    parent_remote_id:parent,remote_name:'address-test',state:'RESERVED',
    appProperties:props};
   return map;
  },
  beginParentCreate:async()=>{
   events.push('begin-attempt');
   map={...map,state:'ATTEMPTED'};
   return {state:'MAY_CREATE',map_id:mapId,file_id:folderId,parent_id:rootId};
  },
  confirmParent:async()=>{events.push('confirmed');},
  reserve:async()=>{throw Error('NO_FILE_BEFORE_PARENTS');}
 };
 const fetcher=async(raw,opts)=>{
  const u=new URL(raw);const key=(opts.method??'GET')+' '+u.pathname;
  events.push(key);
  if(u.pathname==='/drive/v3/about')return Response.json({
   user:{emailAddress:scope,me:true,permissionId:'perm_abc123'}});
  if(u.pathname==='/drive/v3/files/'+rootId)return Response.json({
   id:rootId,mimeType:'application/vnd.google-apps.folder',driveId,
   trashed:false,capabilities:{canAddChildren:true}});
  if(u.pathname==='/drive/v3/files/generateIds')
   return Response.json({ids:[folderId]});
  if(u.pathname==='/drive/v3/files'&&opts.method==='POST'){
   assert.ok(events.indexOf('begin-attempt')<events.indexOf(key));
   const spec=JSON.parse(opts.body);
   assert.equal(spec.id,folderId);assert.equal(spec.parents[0],rootId);
   return Response.json({id:folderId});
  }
  if(u.pathname==='/drive/v3/files/'+folderId)return Response.json({
   id:folderId,name:'address-test',mimeType:'application/vnd.google-apps.folder',
   driveId,trashed:false,parents:[rootId],appProperties:props});
  throw Error('Unexpected provider operation');
 };
 const result=await advanceTrustedDeliveryOneStep({
  ledger,makeWorkerId:()=>uuid(1),
  tokenProvider:async()=>({accessToken:'private-token-not-for-client',
    expiresInSeconds:3600}),expectedEmail:scope,expectedDriveId:driveId,fetcher});
 assert.deepEqual(result,{state:'PARENT_STEP_VERIFIED'});
 assert.equal(events.filter(x=>x==='POST /drive/v3/files').length,1);
 assert.equal(events.filter(x=>x==='confirmed').length,1);
 assert.ok(events.indexOf('begin-attempt')<events.indexOf('POST /drive/v3/files'));
 assert.ok(events.indexOf('POST /drive/v3/files')<
  events.indexOf('GET /drive/v3/files/'+folderId));
});

test('restart resumes exact saved package folder plan with no new claim or Drive ID',async()=>{
 const r=folderRig('ATTEMPTED'),events=r.events;
 const original={state:'ACTIVE',package_id:claim.package_id,worker_id:uuid(1),
  generation:1,destination_id:claim.destination_id,approved_sha256:claim.approved_sha256,
  manifest:claim.manifest};
 const ledger={
  ...r.input.ledger,
  claim:async()=>{throw Error('REPLACEMENT_CLAIM_FORBIDDEN');},
  heartbeat:async()=>{throw Error('UNEXPECTED_PARENT_HEARTBEAT');},
  readActiveLease:async()=>{events.push('read-active');return original;},
  nextReservedItem:async(pkg,worker,gen)=>{
   events.push('next');assert.deepEqual([pkg,worker,gen],[uuid(3),uuid(1),1]);
   return {state:'FOLDER',plan_id:uuid(9)};
  },
  claim:async()=>{throw Error('REPLACEMENT_CLAIM_FORBIDDEN');}
 };
 const done=await advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:r.input.tokenProvider,makeWorkerId:()=>{throw Error('REPLACEMENT_WORKER');},
  expectedEmail:scope,expectedDriveId:driveId,fetcher:r.input.fetcher
 });
 assert.deepEqual(done,{state:'PACKAGE_FOLDER_STEP_VERIFIED'});
 assert.equal(events.includes('plan'),true);
 assert.equal(events.includes('confirm'),true);
 assert.equal(events.includes('POST'),false);
 assert.equal(events.some(v=>String(v).includes('generateIds')),false);
});
test('file plan without backend vault stops before OAuth, private bytes or Google writes',async()=>{
 const events=[];
 const original={state:'ACTIVE',package_id:claim.package_id,worker_id:uuid(1),
  generation:1,destination_id:claim.destination_id,approved_sha256:claim.approved_sha256,
  manifest:claim.manifest};
 const ledger={
  readActiveLease:async()=>{events.push('read');return original;},
  claim:async()=>{throw Error('CLAIM_FORBIDDEN');},
  heartbeat:async()=>{throw Error('HEARTBEAT_FORBIDDEN');},
  nextReservedItem:async()=>{events.push('next');return {
   state:'FILE',kind:'PHOTO',plan_id:uuid(44)};},
  claim:async()=>{throw Error('CLAIM_FORBIDDEN')}
 };
 await assert.rejects(()=>advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:async()=>{events.push('oauth');throw Error('forbidden');},
  makeWorkerId:()=>{throw Error('forbidden');},
  expectedEmail:scope,expectedDriveId:driveId,
  fetcher:async()=>{events.push('network');throw Error('forbidden');}
 }),e=>e instanceof DriveUncertain&&e.code==='TRUSTED_WORKER_NOT_CONFIGURED');
 assert.deepEqual(events,['read','next']);
});
test('all recorded receipts do not imply Google recheck or a final delivery receipt',async()=>{
 const events=[];
 const ledger={
  readActiveLease:async()=>({state:'ACTIVE',package_id:claim.package_id,
   worker_id:uuid(1),generation:1,destination_id:claim.destination_id,
   approved_sha256:claim.approved_sha256,manifest:claim.manifest}),
  claim:async()=>{throw Error('CLAIM_FORBIDDEN');},
  heartbeat:async()=>{throw Error('HEARTBEAT_FORBIDDEN');},
  nextReservedItem:async()=>{events.push('next');
   return {state:'RECEIPTS_READY_FOR_FINAL_RECHECK'};},
  finish:async()=>{throw Error('MUST_NOT_FINISH_WITHOUT_REMOTE_RECHECK');}
 };
 await assert.rejects(()=>advanceTrustedDeliveryOneStep({
  ledger,tokenProvider:async()=>{throw Error('MUST_NOT_USE_OAUTH');},
  makeWorkerId:()=>{throw Error('MUST_NOT_NEW_WORKER');},
  expectedEmail:scope,expectedDriveId:driveId
 }),e=>e instanceof DriveUncertain
  &&e.code==='FINAL_PROVIDER_RECHECK_NOT_CONFIGURED');
 assert.deepEqual(events,['next']);
});
test('invalid server-supplied next plan is denied before provider access',async()=>{
 for(const item of [{state:'FOLDER',plan_id:'not-a-uuid'},
   {state:'FILE',plan_id:uuid(44),kind:'FOLDER'},
   {state:'UNEXPECTED'}]){
  const ledger={
   readActiveLease:async()=>({state:'ACTIVE',package_id:claim.package_id,
    worker_id:uuid(1),generation:1,destination_id:claim.destination_id,
    approved_sha256:claim.approved_sha256,manifest:claim.manifest}),
   claim:async()=>{throw Error('CLAIM_FORBIDDEN');},
   heartbeat:async()=>{throw Error('HEARTBEAT_FORBIDDEN');},
   nextReservedItem:async()=>item
  };
  await assert.rejects(()=>advanceTrustedDeliveryOneStep({
   ledger,tokenProvider:async()=>{throw Error('NO_OAUTH');},
   makeWorkerId:()=>{throw Error('NO_NEW_WORKER');},
   expectedEmail:scope,expectedDriveId:driveId
  }),e=>e instanceof DriveUncertain&&e.code==='FROZEN_DELIVERY_ITEM_UNVERIFIED');
 }
});

function finalRig({moved=false,changedChecksum=false,badSnapshot=false,
  withPhoto=false,movedPhoto=false,changedPhotoChecksum=false}={}){
 const seen=[],org=uuid(31),company=uuid(32);
 const addr='address_'+'a'.repeat(20),wo='workorder_'+'b'.repeat(20);
 const folder='package_'+'c'.repeat(20),manifestFile='manifest_'+'d'.repeat(20);
 const photoFile='photo_'+'e'.repeat(20);
 const sha='a'.repeat(64);
 const props={fwh_package:uuid(3),fwh_manifest:sha};
 const app=(kind,key)=>({
   fwh_org:org,fwh_company:company,fwh_destination:uuid(4),
   fwh_kind:kind,fwh_key:key
 });
 const ancestor=[{
  id:wo,parent:addr,name:'work-order-'+uuid(33),
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,
  appProperties:app('WORK_ORDER',uuid(33))
 },{
  id:addr,parent:rootId,name:'property address',
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,
  appProperties:app('ADDRESS',sha)
 }];
 const files=[{
  id:folder,parent:wo,name:'package-'+uuid(3),
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,appProperties:props
 },
 ...(withPhoto?[{id:photoFile,parent:folder,name:'field-photo-'+uuid(9)+'.jpg',
  mime:'image/jpeg',sha256:'b'.repeat(64),size:250000,appProperties:props}]:[]),
 {id:manifestFile,parent:folder,name:'submission.json',
  mime:'application/json',sha256:sha,size:42,appProperties:props
 }];
 const frozen={...claim.manifest,
   selected_photos:withPhoto?[{photo_id:uuid(9),
     observed_sha256:'b'.repeat(64),observed_size:250000}]:[],
   organization_id:org,client_company_id:company};
 const original={state:'ACTIVE',package_id:uuid(3),worker_id:uuid(1),
  destination_id:uuid(4),generation:1,approved_sha256:sha,manifest:frozen};
 const snapshot={package_id:uuid(3),approved_sha256:sha,destination_id:uuid(4),
  root_id:rootId,ancestors:ancestor,files};
 const ledger={
  readActiveLease:async()=>{seen.push('read-lease');return original;},
  claim:async()=>{throw Error('NO_REPLACEMENT_CLAIM');},
  heartbeat:async()=>{seen.push('heartbeat');},
  nextReservedItem:async()=>{seen.push('next');return {
   state:'RECEIPTS_READY_FOR_FINAL_RECHECK'};},
  finalProviderSnapshot:async()=>{seen.push('snapshot');return badSnapshot
    ?{...snapshot,root_id:'foreign_root_1234567'}:snapshot;},
  finish:async()=>{seen.push('finish');
   return {package_id:uuid(3),status:'DELIVERED',
    manifest_sha256:sha,verified_file_count:files.length};}
 };
 const specs=[
  ...ancestor,...files,
  {id:rootId,mime:'application/vnd.google-apps.folder',trashed:false,
   driveId,capabilities:{canAddChildren:true}}
 ];
 const fetcher=async(raw,opts)=>{
  const path=new URL(raw).pathname;seen.push((opts.method||'GET')+' '+path);
  if(path==='/drive/v3/about')return Response.json({
   user:{emailAddress:scope,me:true,permissionId:'perm-123'}});
  const item=specs.find(p=>path==='/drive/v3/files/'+p.id);
  if(!item)throw Error('UNEXPECTED_URL');
  return Response.json({id:item.id,name:item.name,mimeType:item.mime,
   parents:item.parent?[(moved&&item.id===manifestFile
     ||movedPhoto&&item.id===photoFile)?rootId:item.parent]:undefined,
   driveId,trashed:false,appProperties:item.appProperties,
   sha256Checksum:['application/json','image/jpeg'].includes(item.mime)
     ?(changedChecksum&&item.id===manifestFile
       ||changedPhotoChecksum&&item.id===photoFile)
         ?'0'.repeat(64):item.sha256:undefined,
   size:item.size,capabilities:item.capabilities});
 };
 const args={ledger,tokenProvider:async()=>({accessToken:'private-token-not-for-client',
   expiresInSeconds:3600}),makeWorkerId:()=>{throw Error('NO_NEW_WORKER');},
   expectedEmail:scope,expectedDriveId:driveId,fetcher};
 return {seen,args};
}
test('final trusted wakeup GET-rechecks every ancestor and manifest before SQL receipt',async()=>{
 const r=finalRig();
 assert.deepEqual(await advanceTrustedDeliveryOneStep(r.args),{state:'PACKAGE_DELIVERED'});
 assert.equal(r.seen.filter(v=>v==='finish').length,1);
 assert.equal(r.seen.filter(v=>v.startsWith('GET /drive/v3/files/')).length,5);
 assert.equal(r.seen.some(v=>v.startsWith('POST /drive/')),false);
 assert.equal(r.seen.at(-1),'finish');
});
test('moved remote manifest or altered provider content blocks terminal receipt',async()=>{
 for(const mode of [{moved:true},{changedChecksum:true}]){
  const r=finalRig(mode);
  await assert.rejects(()=>advanceTrustedDeliveryOneStep(r.args),DriveUncertain);
  assert.equal(r.seen.includes('finish'),false);
  assert.equal(r.seen.some(v=>v.startsWith('POST /drive/')),false);
 }
});
test('final snapshot changed remote root blocks before OAuth or Google GET',async()=>{
 const r=finalRig({badSnapshot:true});
 await assert.rejects(()=>advanceTrustedDeliveryOneStep(r.args),e=>
  e instanceof DriveUncertain&&e.code==='FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
 assert.deepEqual(r.seen,['read-lease','next','snapshot']);
});

test('final receipt rechecks selected original JPEG alongside submission manifest',async()=>{
 const r=finalRig({withPhoto:true});
 assert.deepEqual(await advanceTrustedDeliveryOneStep(r.args),{state:'PACKAGE_DELIVERED'});
 assert.equal(r.seen.filter(v=>v==='finish').length,1);
 assert.equal(r.seen.filter(v=>v.startsWith('GET /drive/v3/files/')).length,6);
});
test('changed JPEG parent or hash denies final receipt and preserves original file IDs',async()=>{
 for(const mode of [{movedPhoto:true},{changedPhotoChecksum:true}]){
  const r=finalRig({withPhoto:true,...mode});
  await assert.rejects(()=>advanceTrustedDeliveryOneStep(r.args),DriveUncertain);
  assert.equal(r.seen.includes('finish'),false);
  assert.equal(r.seen.some(v=>v.startsWith('POST /drive/')),false);
 }
});
