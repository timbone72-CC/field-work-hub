import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileOnePreallocatedPackageFolder as reconcile}
  from '../../supabase/functions/client-delivery/folder-one.mjs';
import {createDriveClient,DriveUncertain}
  from '../../supabase/functions/client-delivery/drive-client.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const id='generated_'+'a'.repeat(24),parent='wofolder_'+'b'.repeat(24);
const driveId='clientdrive_'+'c'.repeat(24);
const pkg=uuid(1),worker=uuid(2),planId=uuid(3),wo=uuid(4);
const plan={package_id:pkg,plan_id:planId,kind:'FOLDER',
  parent_kind:'WORK_ORDER',work_order_id:wo,file_id:id,parent_id:parent,
  name:'package-'+pkg,mime:'application/vnd.google-apps.folder',
  sha256:null,size:null,state:'PREALLOCATED',
  appProperties:{fwh_package:pkg,fwh_manifest:'a'.repeat(64)}};
function rig({original=plan,changed=null,postFailure=false,verifyFailure=false,
  revoke=false,beginFailure=false,firstState='PREALLOCATED'}={}){
 const calls=[],committed=[];
 let saved={...original,state:firstState};
 const heartbeat=async()=>{
   calls.push('heartbeat');if(revoke)throw new DriveUncertain('STALE_LEASE');
 };
 const ledger={
   heartbeat,
   getFolderPlan:async which=>{
     calls.push('read');assert.equal(which,planId);
     return changed??saved;
   },
   beginFolderCreate:async which=>{
     calls.push('begin');assert.equal(which,planId);
     if(beginFailure)throw new DriveUncertain('JOURNAL_UNCERTAIN');
     if(saved.state!=='PREALLOCATED')throw new DriveUncertain('ATTEMPT_REPLAY');
     saved={...saved,state:'ATTEMPTED'}; // persists before create
     return {state:'MAY_CREATE',plan_id:planId,file_id:id,parent_id:parent};
   },
   confirmFolder:async (p,w,g,proof)=>{
     calls.push('confirm');assert.equal(w,worker);assert.equal(g,3);
     assert.equal(p.plan_id,planId);assert.equal(proof.id,id);
     saved={...saved,state:'VERIFIED'};committed.push(proof);
   }
 };
 const drive={
   verifyDestination:async ({folderId,expectedDriveId})=>{
     calls.push('verify-parent');
     assert.equal(folderId,parent);assert.equal(expectedDriveId,driveId);
     return {id:folderId};
   },
   createPreallocatedFolder:async spec=>{
     calls.push('create');
     assert.deepEqual(spec,{id,parent,name:plan.name,mime:plan.mime,
       appProperties:plan.appProperties});
     if(postFailure)throw new DriveUncertain('PROVIDER_OUTCOME_UNCERTAIN');
     return {created_id:id,needs_verification:true};
   },
   verifyFile:async spec=>{
     calls.push('verify-file');
     assert.deepEqual(spec,{id,parent,name:plan.name,mime:plan.mime,
       expectedDriveId:driveId,sha256:null,size:null,appProperties:plan.appProperties});
     if(verifyFailure)throw new DriveUncertain('PROVIDER_IDENTITY_UNCERTAIN');
     return {id,parent,name:plan.name,mime:plan.mime,sha256:null,size:null};
   }
 };
 const run=(override=plan)=>reconcile({plan:override,workerId:worker,
    generation:3,drive,ledger,expectedDriveId:driveId});
 return {run,calls,committed,get state(){return saved.state}};
}
test('single new ID is journaled before one create, then exact independent GET and receipt',async()=>{
 const t=rig();const r=await t.run();
 assert.deepEqual(r,{state:'FOLDER_VERIFIED',plan_id:planId});
 assert.equal(t.state,'VERIFIED');assert.equal(t.committed.length,1);
 assert.ok(t.calls.indexOf('begin')<t.calls.indexOf('create'));
 assert.ok(t.calls.indexOf('create')<t.calls.indexOf('verify-file'));
 assert.ok(t.calls.indexOf('verify-file')<t.calls.indexOf('confirm'));
});
test('POST ambiguity survives restart: same ID is verified, never created twice',async()=>{
 const t=rig({postFailure:true});
 await assert.rejects(()=>t.run(),e=>e.code==='PROVIDER_OUTCOME_UNCERTAIN');
 assert.equal(t.state,'ATTEMPTED');
 assert.equal(t.calls.filter(x=>x==='create').length,1);
 // Provider remains inaccessible: no blind retry or fresh Drive ID.
 const next=rig({firstState:'ATTEMPTED',verifyFailure:true});
 await assert.rejects(()=>next.run(),e=>e.code==='PROVIDER_IDENTITY_UNCERTAIN');
 assert.equal(next.calls.includes('create'),false);
 assert.equal(next.calls.includes('begin'),false);
 const found=rig({firstState:'ATTEMPTED'});
 await found.run();
 assert.equal(found.calls.includes('create'),false);
 assert.equal(found.committed.length,1);
});
test('previous VERIFIED state still needs actual remote GET every time',async()=>{
 const t=rig({firstState:'VERIFIED',verifyFailure:true});
 await assert.rejects(()=>t.run(),DriveUncertain);
 assert.deepEqual(t.calls.filter(x=>x==='create'||x==='begin'||x==='confirm'),[]);
});
test('stale worker and uncertain journal block all remote mutations',async()=>{
 const stale=rig({revoke:true});
 await assert.rejects(()=>stale.run(),DriveUncertain);
 assert.deepEqual(stale.calls,['heartbeat']);
 const uncertain=rig({beginFailure:true});
 await assert.rejects(()=>uncertain.run(),DriveUncertain);
 assert.equal(uncertain.calls.includes('create'),false);
 assert.equal(uncertain.committed.length,0);
});
test('wrong hierarchy parent, package identity, or changed server plan is denied',async()=>{
 const bad=[
  {...plan,parent_kind:'ROOT'},
  {...plan,name:'001'},
  {...plan,package_id:uuid(99)},
  {...plan,appProperties:{...plan.appProperties,fwh_package:uuid(99)}},
  {...plan,file_id:parent},
  {...plan,parent_id:id},
  {...plan,mime:'application/octet-stream'},
  {...plan,state:'UNCERTAIN'}
 ];
 for(const p of bad){
  const t=rig();
  await assert.rejects(()=>t.run(p),e=>e.code==='FOLDER_IDENTITY_OR_LEASE_UNCERTAIN');
  assert.deepEqual(t.calls,[]);
 }
 const altered=rig({changed:{...plan,parent_id:'foreign_parent_aaaaaaa'}});
 await assert.rejects(()=>altered.run(),e=>e.code==='FOLDER_IDENTITY_OR_LEASE_UNCERTAIN');
 assert.equal(altered.calls.includes('create'),false);
});
test('Drive adapter also rejects correct-name folders in a foreign Shared Drive',async()=>{
 const drive=createDriveClient({accessToken:'server-test-token-for-client',
   fetcher:async (raw,opts)=>{
     assert.equal(new URL(raw).pathname,'/drive/v3/files/'+id);
     assert.equal(opts.redirect,'error');
     return Response.json({id,name:plan.name,mimeType:plan.mime,
       parents:[parent],trashed:false,appProperties:plan.appProperties,
       driveId:'foreign_client_drive'});
   }});
 await assert.rejects(()=>drive.verifyFile({id,parent,mime:plan.mime,
   name:plan.name,expectedDriveId:driveId,sha256:null,size:null,
   appProperties:plan.appProperties}),e=>e.code==='REMOTE_FILE_IDENTITY_MISMATCH');
});
test('independent Drive GET retains all folder identity details for server confirmation',async()=>{
 const drive=createDriveClient({accessToken:'server-test-token-for-client',
   fetcher:async(raw,opts)=>{
     assert.equal(new URL(raw).pathname,'/drive/v3/files/'+id);
     assert.equal(opts.redirect,'error');
     return Response.json({id,name:plan.name,mimeType:plan.mime,
       parents:[parent],trashed:false,appProperties:plan.appProperties,
       driveId});
   }});
 const result=await drive.verifyFile({id,parent,mime:plan.mime,
   name:plan.name,expectedDriveId:driveId,
   sha256:null,size:null,appProperties:plan.appProperties});
 assert.deepEqual(result,{id,parent,name:plan.name,mime:plan.mime,
   drive_id:driveId,trashed:false,appProperties:plan.appProperties,
   sha256:null,size:null});
});
test('real Drive adapter verifies exact name, parent and appProperties after creation',async()=>{
 const events=[];
 const drive=createDriveClient({accessToken:'server-test-token-for-client',
   fetcher:async(raw,opts)=>{
     const url=new URL(raw);
     events.push([url.pathname,opts.method||'GET']);
     assert.equal(opts.redirect,'error');
     assert.equal(opts.headers.Authorization,'Bearer server-test-token-for-client');
     if(url.pathname==='/drive/v3/files/'+id)
       return Response.json({id,name:'unexpected-foreign-folder',
         mimeType:plan.mime,parents:[parent],trashed:false,
         appProperties:plan.appProperties});
     throw Error('unexpected network endpoint');
   }});
 await assert.rejects(()=>drive.verifyFile({id,parent,mime:plan.mime,
   name:plan.name,expectedDriveId:driveId,sha256:null,size:null,appProperties:plan.appProperties}),
   e=>e.code==='REMOTE_FILE_IDENTITY_MISMATCH');
 assert.equal(events.length,1);
});
