import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOnePreallocatedParent} from '../../supabase/functions/client-delivery/parent-one.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pack=uuid(1),worker=uuid(2),folder='f'.repeat(20),root='r'.repeat(20),driveId='d'.repeat(20);
function rig(kind,state){
 const events=[];
 const map={map_id:uuid(3),kind,remote_folder_id:folder,parent_remote_id:root,
  remote_name:kind==='ADDRESS'?'address-test':'work-order-'+uuid(4),state,
  appProperties:{fwh_org:uuid(5),fwh_company:uuid(6),fwh_destination:uuid(7),
   fwh_kind:kind,fwh_key:kind==='ADDRESS'?'a'.repeat(64):uuid(4)}};
 const drive={
  verifyFile:async()=>{events.push('GET');return {id:folder,parent:root,
   name:map.remote_name,mime:'application/vnd.google-apps.folder',
   drive_id:driveId,trashed:false,appProperties:map.appProperties,
   sha256:null,size:null};},
  verifyDestination:async()=>{events.push('destination');},
  createPreallocatedFolder:async()=>{events.push('POST');}
 };
 const ledger={heartbeat:async()=>{events.push('lease');},
  readParent:async()=>({exists:true,...map}),
  beginParentCreate:async()=>{events.push('begin');return {
   map_id:map.map_id,file_id:folder,parent_id:root,state:'MAY_CREATE'};},
  confirmParent:async()=>{events.push('confirm');}};
 return {events,map,drive,ledger,packageId:pack,workerId:worker,generation:1,expectedDriveId:driveId};
}
for(const kind of ['ADDRESS','WORK_ORDER']){
 test(kind+' first create journals before POST and verifies by GET',async()=>{
  const r=rig(kind,'RESERVED');
  const out=await reconcileOnePreallocatedParent(r);
  assert.equal(out.state,'PARENT_VERIFIED');
  assert.ok(r.events.indexOf('begin')<r.events.indexOf('POST'));
  assert.ok(r.events.indexOf('POST')<r.events.indexOf('GET'));
  assert.ok(r.events.indexOf('GET')<r.events.indexOf('confirm'));
 });
 test(kind+' previously attempted verifies original ID without POST',async()=>{
  const r=rig(kind,'ATTEMPTED');
  await reconcileOnePreallocatedParent(r);
  assert.ok(r.events.includes('GET'));
  assert.equal(r.events.includes('POST'),false);
 });
}
test('race to ATTEMPTED never issues second POST',async()=>{
 const r=rig('ADDRESS','RESERVED');
 r.ledger.beginParentCreate=async()=>({state:'VERIFY_EXISTING',
  map_id:r.map.map_id,file_id:folder,parent_id:root});
 await reconcileOnePreallocatedParent(r);
 assert.equal(r.events.includes('POST'),false);
});
test('wrong frozen parent denies before provider write',async()=>{
 const r=rig('WORK_ORDER','RESERVED');
 r.ledger.readParent=async()=>({exists:true,...r.map,parent_remote_id:'x'.repeat(20)});
 await assert.rejects(()=>reconcileOnePreallocatedParent(r));
 assert.equal(r.events.includes('POST'),false);
});


test('two separately owned packages share one parent CAS and never duplicate Google POST',async()=>{
 const r=rig('ADDRESS','RESERVED'),otherPack=uuid(91),otherWorker=uuid(92);
 const events=[],bothRead=[];
 let releaseReads;
 const barrier=new Promise(resolve=>{releaseReads=resolve});
 let attempted=false,posts=0;
 const db={...r.ledger,
  readParent:async(p)=>{
   bothRead.push(p);
   if(bothRead.length===2)releaseReads();
   await barrier;
   return {exists:true,...r.map};
  },
  beginParentCreate:async()=>{
   events.push('CAS');
   if(attempted)return {state:'VERIFY_EXISTING',map_id:r.map.map_id,
    file_id:folder,parent_id:root};
   attempted=true;return {state:'MAY_CREATE',map_id:r.map.map_id,
    file_id:folder,parent_id:root};
  }
 };
 const drive={...r.drive,
  createPreallocatedFolder:async()=>{
   posts++;events.push('POST');
  },
  verifyFile:async()=>{
   events.push('GET');return {id:folder,parent:root,
    name:r.map.remote_name,mime:'application/vnd.google-apps.folder',
    drive_id:driveId,trashed:false,appProperties:r.map.appProperties,
    sha256:null,size:null};
  }
 };
 const a=reconcileOnePreallocatedParent({...r,ledger:db,drive});
 const b=reconcileOnePreallocatedParent({...r,ledger:db,drive,
  packageId:otherPack,workerId:otherWorker});
 assert.equal((await a).state,'PARENT_VERIFIED');
 assert.equal((await b).state,'PARENT_VERIFIED');
 assert.deepEqual(bothRead.sort(),[pack,otherPack].sort());
 assert.equal(posts,1);
 assert.equal(events.filter(x=>x==='CAS').length,2);
});
