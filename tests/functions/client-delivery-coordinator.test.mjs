import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveProviderIdentities} from '../../supabase/functions/client-delivery/worker-core.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sha='a'.repeat(64);
const frozenPackage={
  claimed:true,package_id:uuid(3),destination_id:uuid(4),generation:1,approved_sha256:sha,
  manifest:{package_id:uuid(3),destination_id:uuid(4),destination_root:'root_'+('b'.repeat(23)),
    review_policy_revision:uuid(8),
    selected_photos:[{photo_id:uuid(9),observed_sha256:sha,observed_size:250000}]}
};
function rig(overrides={}){
 const calls=[]; const claim=overrides.claim??frozenPackage;
 const ledger={
   async claim(worker){calls.push(['claim',worker]);return claim;},
   async heartbeat(...args){calls.push(['heartbeat',...args]);if(overrides.blockHeartbeat)throw new Error('FENCE_LOST');},
   async reserve(...args){calls.push(['reserve',...args]);if(overrides.blockReserve)throw new Error('RESERVATION_FAILED');}
 };
 const drive={
   async verifyProviderIdentity(expected){calls.push(['verifyAccount',expected]);
     if(overrides.blockAccount)throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
     return {account:expected};},
   async verifyDestination({folderId,expectedDriveId}){calls.push(['verifyDestination',folderId,expectedDriveId]);
     if(overrides.blockDestination)throw new DriveUncertain('DESTINATION_NOT_VERIFIED');
     return {id:folderId};},
   async generateIds(count){calls.push(['generateIds',count]);
     return Array.from({length:count},(_,i)=>'generated_'+String(i).padStart(20,'0'));}
 };
 return {ledger,drive,calls};
}
const args={workerId:uuid(1),expectedEmail:'office@example.invalid',expectedDriveId:null};
test('no eligible claim does not touch provider or create remote identities',async()=>{
 const r=rig({claim:{claimed:false}});
 assert.deepEqual(await reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive}),
   {claimed:false});
 assert.deepEqual(r.calls,[['claim',uuid(1)]]);
});
test('wrong Workspace identity or client destination never generates IDs',async()=>{
 for(const bad of [{blockAccount:true},{blockDestination:true}]){
   const r=rig(bad);
   await assert.rejects(()=>reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive}),
     e=>e instanceof DriveUncertain);
   assert.equal(r.calls.some(call=>call[0]==='generateIds'),false);
   assert.equal(r.calls.some(call=>call[0]==='reserve'),false);
 }
});
test('all Drive IDs reserved after verified identity and destination, never any remote write',async()=>{
 const r=rig();
 const reply=await reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive});
 assert.deepEqual(reply,{claimed:true,package_id:uuid(3),generation:1,reserved_count:3,
   ready_for_provider_reconciliation:true,provider_writes_performed:false});
 assert.deepEqual(r.calls.map(x=>x[0]),['claim','verifyAccount','verifyDestination',
   'heartbeat','generateIds','reserve','heartbeat','reserve','heartbeat','reserve']);
 assert.equal(r.calls[5][4],'FOLDER');
 assert.equal(r.calls[7][4],'PHOTO');
 assert.equal(r.calls[9][4],'MANIFEST');
 assert.ok(!JSON.stringify(reply).includes('office@example.invalid'));
});
test('stale lease blocks reserving remote files; protected claims are not retried',async()=>{
 const r=rig({blockHeartbeat:true});
 await assert.rejects(()=>reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive}),
   /FENCE_LOST/);
 assert.equal(r.calls.filter(x=>x[0]==='reserve').length,0);
 assert.equal(r.calls.filter(x=>x[0]==='claim').length,1);
});
test('a failed ID reservation never attempts a remote create or retries with a fresh ID',async()=>{
 const r=rig({blockReserve:true});
 await assert.rejects(()=>reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive}),
   /RESERVATION_FAILED/);
 assert.equal(r.calls.filter(x=>x[0]==='generateIds').length,1);
 assert.equal(r.calls.filter(x=>x[0]==='claim').length,1);
 assert.equal(r.calls.filter(x=>x[0]==='reserve').length,1);
});
test('duplicate, unknown and cross-claim photo identity must not reach provider',async()=>{
 for(const bad of [
  [{photo_id:uuid(9),observed_sha256:sha,observed_size:100},
    {photo_id:uuid(9),observed_sha256:sha,observed_size:100}],
  [{photo_id:uuid(9),observed_sha256:'0',observed_size:100}],
  [{photo_id:uuid(9),observed_sha256:sha,observed_size:0}]
 ]){
   const r=rig({claim:{...frozenPackage,
     manifest:{...frozenPackage.manifest,selected_photos:bad}}});
   await assert.rejects(()=>reserveProviderIdentities({...args,ledger:r.ledger,drive:r.drive}),
     e=>e instanceof DriveUncertain && e.code==='FROZEN_PHOTO_INVALID');
   assert.equal(r.calls.length,1);
 }
});
