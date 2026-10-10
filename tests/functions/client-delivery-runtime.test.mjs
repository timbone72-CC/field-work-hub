import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTrustedDelivery}
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
    ids:['generated_'+'a'.repeat(20),'generated_'+'b'.repeat(20),
      'generated_'+'c'.repeat(20)]});
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
test('valid OAuth identity reserves all IDs and never creates or uploads files',async()=>{
 const r=rig();
 const data=await prepareTrustedDelivery({...args,...r});
 assert.deepEqual(data,{claimed:true,package_id:uuid(3),generation:1,
  reserved_count:3,ready_for_provider_reconciliation:true,provider_writes_performed:false});
 assert.deepEqual(r.events,['oauth','claim','/drive/v3/about','/drive/v3/files/'+rootId,
  'heartbeat','/drive/v3/files/generateIds','reserve','heartbeat','reserve',
  'heartbeat','reserve']);
 assert.equal(JSON.stringify(data).includes('private-token'),false);
});
