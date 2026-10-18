import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveProviderIdentities} from '../../supabase/functions/client-delivery/worker-core.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sha='a'.repeat(64),root='root_'+('b'.repeat(23));
const addressId='address_'+('c'.repeat(23)),woId='wofolder_'+('d'.repeat(23));
const frozenPackage={
 claimed:true,package_id:uuid(3),destination_id:uuid(4),generation:1,approved_sha256:sha,
 manifest:{package_id:uuid(3),destination_id:uuid(4),destination_root:root,
   review_policy_revision:uuid(8),
   selected_photos:[{photo_id:uuid(9),observed_sha256:sha,observed_size:250000}]}
};
function rig(overrides={}){
 const calls=[],claim=overrides.claim??frozenPackage;
 const stored={
   ADDRESS:overrides.addressState?{
     exists:true,kind:'ADDRESS',remote_folder_id:addressId,
     parent_remote_id:overrides.badParent?'foreign_root_1000000000':root,
     state:overrides.addressState
   }:null,
   WORK_ORDER:overrides.woState?{
     exists:true,kind:'WORK_ORDER',remote_folder_id:woId,
     parent_remote_id:overrides.badWoParent?'foreign_address_100000':addressId,
     state:overrides.woState
   }:null
 };
 let counter=0;
 const ledger={
   async claim(worker){calls.push(['claim',worker]);return claim;},
   async heartbeat(...a){calls.push(['heartbeat',...a]);if(overrides.blockHeartbeat)throw Error('FENCE_LOST');},
   async readParent(pkg,worker,gen,kind){
     calls.push(['readParent',kind]);
     return stored[kind]??{exists:false,kind};
   },
   async reserveParent(pkg,worker,gen,kind,id,parent){
     calls.push(['reserveParent',kind,id,parent]);
     if(overrides.blockReserveParent)throw Error('PARENT_RESERVATION_FAILED');
     stored[kind]={exists:true,kind,remote_folder_id:id,parent_remote_id:parent,state:'RESERVED'};
     return {...stored[kind]};
   },
   async reserve(...args){calls.push(['reserve',...args]);if(overrides.blockReserve)throw Error('RESERVATION_FAILED');}
 };
 const drive={
   async verifyProviderIdentity(expected){calls.push(['verifyAccount',expected]);
     if(overrides.blockAccount)throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
     return {account:expected};},
   async verifyDestination({folderId,expectedDriveId}){
     calls.push(['verifyDestination',folderId,expectedDriveId]);
     if(overrides.blockDestination)throw new DriveUncertain('DESTINATION_NOT_VERIFIED');
     return {id:folderId};},
   async generateIds(count){calls.push(['generateIds',count]);
     const ids=Array.from({length:count},()=> 'generated_'+String(++counter).padStart(20,'0'));
     return overrides.duplicateIds&&count>1?ids.map(()=>ids[0]):ids;}
 };
 return {ledger,drive,calls,stored};
}
const args={workerId:uuid(1),expectedEmail:'office@example.invalid',expectedDriveId:'client_'+('x'.repeat(25))};
const run=r=>reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive});
test('no eligible claim does not touch provider or allocate remote identities',async()=>{
 const r=rig({claim:{claimed:false}});
 assert.deepEqual(await run(r),{claimed:false});
 assert.deepEqual(r.calls,[['claim',uuid(1)]]);
});
test('wrong Workspace or root client destination cannot generate IDs',async()=>{
 for(const bad of [{blockAccount:true},{blockDestination:true}]){
   const r=rig(bad);
   await assert.rejects(()=>run(r),e=>e instanceof DriveUncertain);
   assert.equal(r.calls.some(x=>x[0]==='generateIds'),false);
   assert.equal(r.calls.some(x=>x[0]==='reserveParent'),false);
   assert.equal(r.calls.some(x=>x[0]==='reserve'),false);
 }
});
test('first pass reserves address only; never jumps to WO or package',async()=>{
 const r=rig(),out=await run(r);
 assert.deepEqual(out,{claimed:true,package_id:uuid(3),generation:1,
   reserved_count:1,next_parent_kind:'ADDRESS',
   ready_for_provider_reconciliation:true,provider_writes_performed:false});
 assert.deepEqual(r.calls.map(x=>x[0]),['claim','verifyAccount','verifyDestination',
   'heartbeat','readParent','heartbeat','generateIds','heartbeat','reserveParent']);
 assert.deepEqual(r.calls.find(x=>x[0]==='reserveParent').slice(1,2),['ADDRESS']);
 assert.equal(r.calls.find(x=>x[0]==='reserveParent')[3],root);
 assert.equal(r.calls.some(x=>x[0]==='reserve'),false);
});
test('existing RESERVED/ATTEMPTED address ID reuses original without replacement generateIds',async()=>{
 for(const state of ['RESERVED','ATTEMPTED']){
   const r=rig({addressState:state});
   const out=await run(r);
   assert.equal(out.next_parent_kind,'ADDRESS');
   assert.equal(out.reserved_count,0);
   assert.equal(r.calls.some(x=>x[0]==='generateIds'),false);
   assert.equal(r.calls.some(x=>x[0]==='reserve'),false);
 }
});
test('verified address reserves WO ID exactly once; package files still blocked',async()=>{
 const r=rig({addressState:'VERIFIED'});
 const out=await run(r);
 assert.equal(out.next_parent_kind,'WORK_ORDER');
 assert.equal(out.reserved_count,1);
 assert.equal(r.calls.filter(x=>x[0]==='generateIds').length,1);
 const parent=r.calls.find(x=>x[0]==='reserveParent');
 assert.equal(parent[1],'WORK_ORDER');
 assert.equal(parent[3],addressId);
 assert.equal(r.calls.some(x=>x[0]==='reserve'),false);
});
test('verified address and WO reserve package and selected immutable files only under WO',async()=>{
 const r=rig({addressState:'VERIFIED',woState:'VERIFIED'});
 const data=await run(r);
 assert.deepEqual(data,{claimed:true,package_id:uuid(3),generation:1,
   reserved_count:3,ready_for_provider_reconciliation:true,
   provider_writes_performed:false});
 const reserves=r.calls.filter(x=>x[0]==='reserve');
 assert.deepEqual(reserves.map(x=>x[4]),['FOLDER','PHOTO','MANIFEST']);
 assert.equal(reserves[0][7],woId);
 assert.equal(reserves[1][7],reserves[0][6]);
 assert.equal(reserves[2][7],reserves[0][6]);
 assert.equal(r.calls.filter(x=>x[0]==='verifyDestination').length,2);
 assert.equal(r.calls.at(-1)[0],'reserve');
 assert.equal(r.calls.some(x=>x[0]==='reserveParent'),false);
 assert.equal(r.calls.find(x=>x[0]==='generateIds')[1],3);
 assert.equal(JSON.stringify(data).includes('office@example.invalid'),false);
});
test('wrong ADDRESS/WO parent and uncertain mapping stop before any ID generation',async()=>{
 for(const bad of [
   {addressState:'VERIFIED',badParent:true},
   {addressState:'VERIFIED',woState:'VERIFIED',badWoParent:true},
   {addressState:'UNCERTAIN'}]){
   const r=rig(bad);
   await assert.rejects(()=>run(r),e=>
     e instanceof DriveUncertain&&e.code==='FROZEN_PARENT_IDENTITY_UNCERTAIN');
   assert.equal(r.calls.some(x=>x[0]==='generateIds'),false);
   assert.equal(r.calls.some(x=>x[0]==='reserve'),false);
 }
});
test('duplicate generated photo IDs and stale lease never reserve replacement IDs',async()=>{
 const stale=rig({blockHeartbeat:true});
 await assert.rejects(()=>run(stale),/FENCE_LOST/);
 assert.equal(stale.calls.some(x=>x[0]==='generateIds'),false);
 const dup=rig({addressState:'VERIFIED',woState:'VERIFIED',duplicateIds:true});
 await assert.rejects(()=>run(dup),e=>
   e instanceof DriveUncertain&&e.code==='REMOTE_IDS_UNAVAILABLE');
 assert.equal(dup.calls.some(x=>x[0]==='reserve'),false);
});
test('failed parent or file reservation does not blind retry and create another ID',async()=>{
 const parent=rig({blockReserveParent:true});
 await assert.rejects(()=>run(parent),/PARENT_RESERVATION_FAILED/);
 assert.equal(parent.calls.filter(x=>x[0]==='generateIds').length,1);
 assert.equal(parent.calls.filter(x=>x[0]==='reserveParent').length,1);
 const files=rig({addressState:'VERIFIED',woState:'VERIFIED',blockReserve:true});
 await assert.rejects(()=>run(files),/RESERVATION_FAILED/);
 assert.equal(files.calls.filter(x=>x[0]==='generateIds').length,1);
 assert.equal(files.calls.filter(x=>x[0]==='reserve').length,1);
});
test('duplicated, invalid or non-accepted photo identity is rejected before provider access',async()=>{
 for(const bad of [
  [{photo_id:uuid(9),observed_sha256:sha,observed_size:100},
   {photo_id:uuid(9),observed_sha256:sha,observed_size:100}],
  [{photo_id:uuid(9),observed_sha256:'0',observed_size:100}],
  [{photo_id:uuid(9),observed_sha256:sha,observed_size:0}]]){
   const r=rig({claim:{...frozenPackage,manifest:{...frozenPackage.manifest,
     selected_photos:bad}}});
   await assert.rejects(()=>run(r),e=>
     e instanceof DriveUncertain&&e.code==='FROZEN_PHOTO_INVALID');
   assert.deepEqual(r.calls.map(x=>x[0]),['claim']);
 }
});
