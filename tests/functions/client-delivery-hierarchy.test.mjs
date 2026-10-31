import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOnePreallocatedParent} from '../../supabase/functions/client-delivery/parent-one.mjs';
import {reconcileOnePreallocatedPackageFolder} from '../../supabase/functions/client-delivery/folder-one.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=uuid(1),company=uuid(2),destination=uuid(3),pkg=uuid(4),worker=uuid(5);
const otherCompany=uuid(20), otherDestination=uuid(21);
const driveId='shared_'+'d'.repeat(24),root='root_'+'r'.repeat(24),address='addr_'+'a'.repeat(24);
const wo='work_'+'w'.repeat(24),packageFolder='pkg_'+'p'.repeat(24),sha='a'.repeat(64);
function makeHierarchy(){
 const events=[],objects=new Map(), maps=new Map(), attempts=new Map();
 objects.set(root,{id:root,name:'Client TEST',parent:null,drive_id:driveId});
 const properties=(kind,key,c=company,d=destination)=>({
  fwh_org:org,fwh_company:c,fwh_destination:d,fwh_kind:kind,fwh_key:key
 });
 const addressMap={map_id:uuid(6),kind:'ADDRESS',remote_folder_id:address,
  parent_remote_id:root,remote_name:'Test Address - aaa',state:'RESERVED',
  appProperties:properties('ADDRESS',sha)};
 const workMap={map_id:uuid(7),kind:'WORK_ORDER',remote_folder_id:wo,
  parent_remote_id:address,remote_name:'work-order-'+uuid(8),state:'RESERVED',
  appProperties:properties('WORK_ORDER',uuid(8))};
 for(const m of [addressMap,workMap])maps.set(m.kind,m);
 const plan={package_id:pkg,plan_id:uuid(9),kind:'FOLDER',parent_kind:'WORK_ORDER',
  file_id:packageFolder,parent_id:wo,name:'package-'+pkg,work_order_id:uuid(8),
  mime:'application/vnd.google-apps.folder',sha256:null,size:null,
  appProperties:{fwh_package:pkg,fwh_manifest:sha},state:'PREALLOCATED'};
 const ledger={
  heartbeat:async()=>{events.push('lease');},
  readParent:async(_p,_w,_g,kind)=>({exists:true,...maps.get(kind)}),
  beginParentCreate:async(_p,_w,_g,id)=>{
   const m=[...maps.values()].find(v=>v.map_id===id);
   if(!m)throw Error('map missing');
   const existing=attempts.get(id);
   if(existing)return {state:'VERIFY_EXISTING',map_id:id,file_id:m.remote_folder_id,parent_id:m.parent_remote_id};
   attempts.set(id,true);m.state='ATTEMPTED';events.push('begin:'+m.kind);
   return {state:'MAY_CREATE',map_id:id,file_id:m.remote_folder_id,parent_id:m.parent_remote_id};
  },
  confirmParent:async(_p,_w,_g,id,proof)=>{
   const m=[...maps.values()].find(v=>v.map_id===id);
   assert.equal(proof.parent,m.parent_remote_id);
   assert.deepEqual(proof.appProperties,m.appProperties);
   m.state='VERIFIED';events.push('confirm:'+m.kind);
  },
  getFolderPlan:async()=>({...plan}),
  beginFolderCreate:async()=>{
   if(attempts.get(plan.plan_id))return {state:'VERIFY_EXISTING',plan_id:plan.plan_id,
    file_id:packageFolder,parent_id:wo};
   attempts.set(plan.plan_id,true);plan.state='ATTEMPTED';
   events.push('begin:PACKAGE');
   return {state:'MAY_CREATE',plan_id:plan.plan_id,file_id:packageFolder,parent_id:wo};
  },
  confirmFolder:async(_p,_w,_g,proof)=>{
   assert.equal(proof.id,packageFolder);assert.equal(proof.parent,wo);
   plan.state='VERIFIED';events.push('confirm:PACKAGE');
  }
 };
 const drive={
  verifyDestination:async({folderId,expectedDriveId})=>{
   const f=objects.get(folderId);
   if(!f||f.drive_id!==expectedDriveId)throw Error('DESTINATION_NOT_VERIFIED');
   events.push('destination:'+folderId);return {id:folderId};
  },
  createPreallocatedFolder:async(spec)=>{
   if(objects.has(spec.id)||!objects.has(spec.parent))throw Error('BAD_CREATE');
   objects.set(spec.id,{id:spec.id,parent:spec.parent,name:spec.name,
    mime:spec.mime,drive_id:driveId,appProperties:spec.appProperties});
   events.push('POST:'+spec.id);
  },
  verifyFile:async(spec)=>{
   const o=objects.get(spec.id);
   if(!o||o.parent!==spec.parent||o.name!==spec.name
    ||o.drive_id!==spec.expectedDriveId||o.mime!==spec.mime
    ||JSON.stringify(o.appProperties)!==JSON.stringify(spec.appProperties))
    throw Error('IDENTITY_MISMATCH');
   events.push('GET:'+spec.id);
   return {id:o.id,parent:o.parent,name:o.name,mime:o.mime,
    drive_id:o.drive_id,trashed:false,appProperties:o.appProperties,sha256:null,size:null};
  }
 };
 return {events,objects,maps,plan,ledger,drive,addressMap,workMap};
}
const parentArgs=r=>({packageId:pkg,workerId:worker,generation:1,
 expectedDriveId:driveId,drive:r.drive,ledger:r.ledger});
const folderArgs=r=>({plan:{...r.plan},workerId:worker,generation:1,
 expectedDriveId:driveId,drive:r.drive,ledger:r.ledger});
test('full isolated root -> ADDRESS -> WORK_ORDER -> PACKAGE creation and independent GET',async()=>{
 const r=makeHierarchy();
 await reconcileOnePreallocatedParent({...parentArgs(r),map:{...r.addressMap}});
 await reconcileOnePreallocatedParent({...parentArgs(r),map:{...r.workMap}});
 await reconcileOnePreallocatedPackageFolder(folderArgs(r));
 assert.deepEqual([r.objects.get(address).parent,r.objects.get(wo).parent,
  r.objects.get(packageFolder).parent],[root,address,wo]);
 assert.deepEqual(r.events.filter(v=>v.startsWith('POST:')),
  ['POST:'+address,'POST:'+wo,'POST:'+packageFolder]);
 for(const id of [address,wo,packageFolder]){
  assert.ok(r.events.indexOf('POST:'+id)<r.events.indexOf('GET:'+id));
 }
});
test('restart after recorded attempts verifies original IDs without another POST',async()=>{
 const r=makeHierarchy();
 for(const m of [r.addressMap,r.workMap]){
  m.state='ATTEMPTED';r.objects.set(m.remote_folder_id,{id:m.remote_folder_id,
   parent:m.parent_remote_id,name:m.remote_name,mime:'application/vnd.google-apps.folder',
   drive_id:driveId,appProperties:m.appProperties});
 }
 r.plan.state='ATTEMPTED';r.objects.set(packageFolder,{id:packageFolder,parent:wo,
  name:r.plan.name,mime:r.plan.mime,drive_id:driveId,appProperties:r.plan.appProperties});
 await reconcileOnePreallocatedParent({...parentArgs(r),map:{...r.addressMap}});
 await reconcileOnePreallocatedParent({...parentArgs(r),map:{...r.workMap}});
 await reconcileOnePreallocatedPackageFolder(folderArgs(r));
 assert.equal(r.events.some(v=>v.startsWith('POST:')),false);
 assert.equal(r.events.filter(v=>v.startsWith('GET:')).length,3);
});
test('cross-company and wrong destination map cannot write any Google folder',async()=>{
 for(const field of ['fwh_company','fwh_destination']){
  const r=makeHierarchy(),m={...r.addressMap,appProperties:{...r.addressMap.appProperties}};
  m.appProperties[field]=field==='fwh_company'?otherCompany:otherDestination;
  await assert.rejects(()=>reconcileOnePreallocatedParent({...parentArgs(r),map:m}));
  assert.equal(r.events.some(v=>v.startsWith('POST:')),false);
 }
});
test('different Shared Drive and wrong WO parent fail closed',async()=>{
 const r=makeHierarchy();
 await assert.rejects(()=>reconcileOnePreallocatedParent({
  ...parentArgs(r),map:{...r.addressMap},expectedDriveId:'foreign_'+'x'.repeat(20)}));
 assert.equal(r.events.some(v=>v.startsWith('POST:')),false);
 const second=makeHierarchy();
 second.workMap.parent_remote_id='foreign_'+'y'.repeat(20);
 await assert.rejects(()=>reconcileOnePreallocatedParent({
  ...parentArgs(second),map:{...second.workMap}}));
 assert.equal(second.events.some(v=>v.startsWith('POST:')),false);
});
