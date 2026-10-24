import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveProviderIdentities} from '../../supabase/functions/client-delivery/worker-core.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const root='root_'+'r'.repeat(24), driveId='drive_'+'d'.repeat(24);
const kinds=['STATE','COUNTY','CITY','ADDRESS','WORK_ORDER'];
const claim={claimed:true,package_id:uuid(10),destination_id:uuid(11),generation:1,
 approved_sha256:'a'.repeat(64),manifest:{package_id:uuid(10),destination_id:uuid(11),
  destination_root:root,review_policy_revision:uuid(12),selected_photos:[],
  folder_layout:'STATE_COUNTY_CITY_ADDRESS',
  geographic_path:{state:'oklahoma',county:'beckham',city:'elk city'}}};
function rig({states={},unsupported=false,foreign=false,cityUnderState=false}={}){
 const calls=[],ids=Object.fromEntries(kinds.map((k,i)=>[k,'folder_'+i+'_'+'x'.repeat(22)]));
 const map=new Map();let previous=root;
 for(const kind of kinds){
   if(states[kind])map.set(kind,{exists:true,kind,remote_folder_id:ids[kind],
     parent_remote_id:foreign&&kind==='CITY'?'foreign_'+'q'.repeat(24)
       :cityUnderState&&kind==='CITY'?ids.STATE:previous,
     state:states[kind]});
   previous=ids[kind];
 }
 let serial=0;
 const read=async(method,kind)=>{
   calls.push(method+':'+kind);return map.get(kind)??{exists:false,kind};
 };
 const reserve=async(method,kind,id,parent)=>{
   calls.push(method+':'+kind);
   const saved={exists:true,kind,remote_folder_id:id,parent_remote_id:parent,state:'RESERVED'};
   map.set(kind,saved);return saved;
 };
 const ledger={
   claim:async()=>unsupported?{...claim,manifest:{...claim.manifest,
     folder_layout:'UNSUPPORTED_LAYOUT'}}:claim,
   heartbeat:async()=>{calls.push('heartbeat')},
   readParent:async(_p,_w,_g,k)=>read('readParent',k),
   reserveParent:async(_p,_w,_g,k,id,p)=>reserve('reserveParent',k,id,p),
   readGeographicLeaf:async(_p,_w,_g,k)=>read('readGeographicLeaf',k),
   reserveGeographicLeaf:async(_p,_w,_g,k,id,p)=>reserve('reserveGeographicLeaf',k,id,p),
   nextReservedItem:async()=>({state:'UNRESERVED'}),
   reserveBatch:async(pkg,worker,gen,folder,parent,photos,manifest)=>{
     calls.push('reserveFileSet');
     return {reserved:true,package_id:pkg,folder_id:folder,
       manifest_id:manifest,reserved_count:photos.length+2};
   }
 };
 const drive={
   verifyProviderIdentity:async expected=>({account:expected}),
   verifyDestination:async({folderId})=>({id:folderId}),
   generateIds:async n=>Array.from({length:n},()=>'generated_'+String(++serial).padStart(20,'0'))
 };
 return {ledger,drive,calls,ids};
}
const run=r=>reserveProviderIdentities({ledger:r.ledger,drive:r.drive,
 workerId:uuid(1),expectedEmail:'office@example.invalid',expectedDriveId:driveId});
test('first geographic preallocation only reserves STATE under client root',async()=>{
 const r=rig(),result=await run(r);
 assert.equal(result.next_parent_kind,'STATE');
 assert.equal(result.reserved_count,1);
 assert.ok(r.calls.includes('readParent:STATE'));
 assert.ok(r.calls.includes('reserveParent:STATE'));
 assert.equal(r.calls.some(x=>x.includes('ADDRESS')),false);
});
test('geographic path reserves only immediate child of verified parent',async()=>{
 for(let i=1;i<kinds.length;i++){
   const states=Object.fromEntries(kinds.slice(0,i).map(k=>[k,'VERIFIED']));
   const r=rig({states}),result=await run(r);
   assert.equal(result.next_parent_kind,kinds[i]);
   assert.equal(result.reserved_count,1);
   const method=i>=3?'reserveGeographicLeaf':'reserveParent';
   assert.ok(r.calls.includes(method+':'+kinds[i]));
   if(i>=3)assert.ok(!r.calls.includes('reserveParent:'+kinds[i]));
 }
});
test('verified geographic hierarchy reserves package beneath exact work order',async()=>{
 const r=rig({states:Object.fromEntries(kinds.map(k=>[k,'VERIFIED']))});
 const result=await run(r);
 assert.equal(result.reserved_count,2);
 assert.equal(result.provider_writes_performed,false);
 assert.ok(r.calls.includes('readGeographicLeaf:ADDRESS'));
 assert.ok(r.calls.includes('readGeographicLeaf:WORK_ORDER'));
 assert.ok(r.calls.includes('reserveFileSet'));
 assert.ok(!r.calls.includes('reserveParent:ADDRESS'));
});
test('wrong ancestor and unsupported layout fail closed',async()=>{
 const r=rig({states:Object.fromEntries(kinds.map(k=>[k,'VERIFIED'])),foreign:true});
 await assert.rejects(()=>run(r),e=>e instanceof DriveUncertain
  &&e.code==='FROZEN_PARENT_IDENTITY_UNCERTAIN');
 assert.ok(!r.calls.some(c=>c.startsWith('reserveFileSet')));
 const unsupported=rig({unsupported:true});
 await assert.rejects(()=>run(unsupported),e=>e instanceof DriveUncertain
  &&e.code==='FROZEN_FOLDER_LAYOUT_UNSUPPORTED');
 assert.deepEqual(unsupported.calls,[]);
});

test('State-City layout reserves STATE then CITY then ADDRESS then WORK_ORDER, never COUNTY',async()=>{
 const original=claim.manifest;
 const states={STATE:'VERIFIED'};
 const r=rig({states});
 const get=r.ledger.claim;
 r.ledger.claim=async()=>({ ...claim,manifest:{...original,folder_layout:'STATE_CITY_ADDRESS'}});
 const first=await run(r);
 assert.equal(first.next_parent_kind,'CITY');
 assert.ok(r.calls.includes('reserveParent:CITY'));
 assert.ok(!r.calls.some(c=>c.includes('COUNTY')));
});
test('State-City path continues to geographic leaves under verified city',async()=>{
 const r=rig({states:{STATE:'VERIFIED',CITY:'VERIFIED'},cityUnderState:true});
 r.ledger.claim=async()=>({...claim,manifest:{...claim.manifest,folder_layout:'STATE_CITY_ADDRESS'}});
 const out=await run(r);
 assert.equal(out.next_parent_kind,'ADDRESS');
 assert.ok(r.calls.includes('reserveGeographicLeaf:ADDRESS'));
 assert.ok(!r.calls.some(c=>c.includes('COUNTY')));
});
