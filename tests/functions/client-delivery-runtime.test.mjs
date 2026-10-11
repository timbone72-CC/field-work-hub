import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTrustedDelivery,continueTrustedPackageFolder}
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
test('wrong current OAuth identity refuses folder write before lease continuation',async()=>{
 const r=folderRig();
 r.input.expectedEmail='different@example.invalid';
 await assert.rejects(()=>continueTrustedPackageFolder(r.input),e=>
  e instanceof DriveUncertain&&e.code==='WORKSPACE_ACCOUNT_MISMATCH');
 assert.equal(r.events.includes('POST'),false);
 assert.equal(r.events.includes('plan'),false);
});
