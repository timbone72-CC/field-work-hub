import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOnePreallocatedParent} from '../../supabase/functions/client-delivery/parent-one.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=uuid(1),company=uuid(2),dest=uuid(3),pkg=uuid(4),worker=uuid(5);
const root='root_'+'a'.repeat(24),driveId='drive_'+'d'.repeat(24);
const chainKinds={
 ADDRESS_WORK_ORDER:['ADDRESS','WORK_ORDER'],
 STATE_CITY_ADDRESS:['STATE','CITY','ADDRESS','WORK_ORDER'],
 STATE_COUNTY_CITY_ADDRESS:['STATE','COUNTY','CITY','ADDRESS','WORK_ORDER']
};
function setup(layout,{restart=false,wrongCompany=false,wrongDrive=false}={}){
 const kinds=chainKinds[layout],objects=new Map([[root,{id:root,drive_id:driveId}]]),maps=new Map();
 let parent=root;const events=[];
 kinds.forEach((kind,i)=>{
  const id='node_'+String(i)+'_'+'x'.repeat(24);
  const props={fwh_org:org,fwh_company:wrongCompany&&kind==='CITY'?uuid(99):company,
   fwh_destination:dest,fwh_kind:kind,fwh_key:kind==='WORK_ORDER'?uuid(44):'a'.repeat(64)};
  const m={map_id:uuid(10+i),kind,remote_folder_id:id,parent_remote_id:parent,
   remote_name:kind+'-test-folder',state:restart?'ATTEMPTED':'RESERVED',
   appProperties:props};
  maps.set(kind,m);
  if(restart)objects.set(id,{id,parent,name:m.remote_name,
   mime:'application/vnd.google-apps.folder',drive_id:driveId,appProperties:props});
  parent=id;
 });
 const ledger={
  heartbeat:async()=>{},
  readParent:async(_p,_w,_g,kind)=>{\n    const m=maps.get(kind);\n    if(m?.appProperties.fwh_company!==company||m?.appProperties.fwh_destination!==dest)\n      throw Error('SERVER_COMPANY_SCOPE_DENIED');\n    return {exists:true,...m};\n  },
  beginParentCreate:async(_p,_w,_g,id)=>{
    const m=[...maps.values()].find(m=>m.map_id===id);
    m.state='ATTEMPTED';events.push('BEGIN:'+m.kind);
    return {state:'MAY_CREATE',map_id:id,file_id:m.remote_folder_id,parent_id:m.parent_remote_id};
  },
  confirmParent:async(_p,_w,_g,id,proof)=>{
    const m=[...maps.values()].find(m=>m.map_id===id);
    assert.equal(proof.parent,m.parent_remote_id);
    assert.deepEqual(proof.appProperties,m.appProperties);
    m.state='VERIFIED';events.push('CONFIRM:'+m.kind);
  }
 };
 const drive={
  verifyDestination:async({folderId,expectedDriveId})=>{
    const o=objects.get(folderId);
    if(!o||o.drive_id!==expectedDriveId)throw Error('WRONG_PROVIDER_PARENT');
  },
  createPreallocatedFolder:async({id,parent,name,mime,appProperties})=>{
    if(!objects.has(parent)||objects.has(id))throw Error('CREATE_CONFLICT');
    objects.set(id,{id,parent,name,mime,drive_id:driveId,appProperties});
    events.push('POST:'+id);
  },
  verifyFile:async({id,parent,name,mime,appProperties,expectedDriveId})=>{
    const o=objects.get(id);
    if(!o||o.parent!==parent||o.name!==name||o.mime!==mime||
       o.drive_id!==expectedDriveId||
       JSON.stringify(o.appProperties)!==JSON.stringify(appProperties))
      throw Error('INDEPENDENT_GET_MISMATCH');
    events.push('GET:'+id);
    return {id,parent,name,mime,drive_id:o.drive_id,trashed:false,
      appProperties:o.appProperties};
  }
 };
 return {kinds,maps,objects,events,ledger,drive,expectedDriveId:wrongDrive?'foreign_'+'z'.repeat(24):driveId};
}
async function reconcile(r,kind){
 return reconcileOnePreallocatedParent({
  map:{...r.maps.get(kind)},packageId:pkg,workerId:worker,generation:1,
  drive:r.drive,ledger:r.ledger,expectedDriveId:r.expectedDriveId});
}
for(const layout of Object.keys(chainKinds)){
 test(layout+' creates exact chained parents with one POST and GET each',async()=>{
  const r=setup(layout);
  for(const kind of r.kinds)await reconcile(r,kind);
  assert.equal(r.events.filter(e=>e.startsWith('POST:')).length,r.kinds.length);
  assert.equal(r.events.filter(e=>e.startsWith('GET:')).length,r.kinds.length);
  assert.equal(r.events.filter(e=>e.startsWith('CONFIRM:')).length,r.kinds.length);
 });
 test(layout+' restart never repeats POST after an attempted create',async()=>{
  const r=setup(layout,{restart:true});
  for(const kind of r.kinds)await reconcile(r,kind);
  assert.equal(r.events.some(e=>e.startsWith('POST:')),false);
  assert.equal(r.events.filter(e=>e.startsWith('GET:')).length,r.kinds.length);
 });
 test(layout+' rejects foreign Shared Drive without creating folders',async()=>{
  const r=setup(layout,{wrongDrive:true});
  await assert.rejects(()=>reconcile(r,r.kinds[0]));
  assert.equal(r.events.some(e=>e.startsWith('POST:')),false);
 });
}
test('geographic folder metadata mismatch denies foreign company before POST',async()=>{
 const r=setup('STATE_COUNTY_CITY_ADDRESS',{wrongCompany:true});
 await assert.rejects(()=>reconcile(r,'CITY'));
 assert.equal(r.events.some(e=>e.startsWith('POST:')),false);
});
