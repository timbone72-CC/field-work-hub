import test from 'node:test';
import assert from 'node:assert/strict';
import {continueTrustedDeliveryFile} from '../../supabase/functions/client-delivery/worker-runtime.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const worker=uuid(1),pkg=uuid(2),planId=uuid(3),photo=uuid(4),gen=4;
const org=uuid(5),wo=uuid(6),run=uuid(7),owner=uuid(8);
const projectUrl='https://vyocaujuwrivoqynvitm.supabase.co';
const serviceRoleJwt='service.secret.jwt';
const expectedEmail='office@example.invalid';
const expectedDriveId='drive_'+'d'.repeat(20);
const parent='folder_'+'f'.repeat(20);
const file='generated_'+'a'.repeat(20);
const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-session';
const size=300000,sha='a'.repeat(64);
const plan={
 package_id:pkg,plan_id:planId,kind:'PHOTO',photo_id:photo,
 file_id:file,parent_id:parent,name:'field-photo-'+photo+'.jpg',mime:'image/jpeg',sha256:sha,size,
 appProperties:{fwh_package:pkg,fwh_manifest:'b'.repeat(64)},
 source:{bucket:'fwh-review-private',object_key:[org,wo,run,photo+'.jpg'].join('/'),
  object_id:uuid(9),object_version:'v1',owner_id:owner,photo_id:photo,
  transfer_version:uuid(10)}
};
function rig({wrongAccount=false,wrongDrive=false,leaseRevoked=false,
  planChanged=false,shortRange=false,remoteMoved=false,remoteRenamed=false}={}){
 const events=[],bytes=new Uint8Array(size);
 let offset=0,sessionStored=null,startAttempted=false,confirmed=0,posts=0,uploads=0,projections=0;
 const lease={
  heartbeat:async()=>{events.push('lease');if(leaseRevoked)throw Error('LEASE_EXPIRED');},
  getFilePlan:async id=>{
   events.push('projection');
   if(leaseRevoked)throw Error('STALE_LEASE');
   assert.equal(id,planId);
   return planChanged&&++projections>1?{...plan,file_id:'wrong_identity'}:plan;
  },
  getSession:async()=>{
   events.push('load_session');
   if(startAttempted&&!sessionStored)throw new DriveUncertain('UPLOAD_SESSION_START_UNCERTAIN');
   return sessionStored;
  },
  beginSession:async id=>{
   assert.equal(id,planId);events.push('durable_start');
   if(startAttempted)throw new DriveUncertain('UPLOAD_SESSION_START_UNCERTAIN');
   startAttempted=true;
   return {plan_id:planId,start_recorded:true};
  },
  storeSession:async(p,w,g,id,encrypted)=>{
   assert.deepEqual([p,w,g,id],[pkg,worker,gen,planId]);events.push('persist_session');
   sessionStored={package_id:pkg,plan_id:planId,total_bytes:size,encrypted};
  },
  recordOffset:async(p,w,g,id,at)=>{
   events.push('record:'+at);assert.equal(at>=offset,true);offset=at;
  },
  confirmFile:async()=>{events.push('verify_receipt');confirmed++;}
 };
 const ledger={forLease:(p,w,g)=>{
  assert.deepEqual([p,w,g],[pkg,worker,gen]);return lease;
 }};
 const tokenProvider=async()=>{
  events.push('oauth');return {accessToken:'private-oauth-token-for-server',expiresInSeconds:3600};
 };
 const vault={
  seal:async value=>{
   assert.equal(value,session);events.push('seal');return {ciphertext:'sealed'};
  },
  open:async()=>{
   events.push('unseal');return session;
  }
 };
 const fetcher=async(raw,opts)=>{
  const u=new URL(raw);
  if(u.origin==='https://www.googleapis.com'){
   assert.equal(opts.headers.Authorization,'Bearer private-oauth-token-for-server');
   if(u.pathname==='/drive/v3/about'){
    events.push('account');
    return Response.json({user:{emailAddress:wrongAccount?'wrong@example.invalid':expectedEmail,
      permissionId:'permA',me:true}});
   }
   if(u.pathname==='/drive/v3/files/'+parent){
    events.push('parent');
    return Response.json({id:parent,trashed:false,
      mimeType:'application/vnd.google-apps.folder',
      driveId:wrongDrive?'wrong-drive-id':expectedDriveId,
      capabilities:{canAddChildren:true}});
   }
   if(u.pathname==='/upload/drive/v3/files'){
    if(opts.method==='POST'){
     const metadata=JSON.parse(opts.body);
     assert.equal(metadata.name,'field-photo-'+photo+'.jpg');
     assert.equal(metadata.id,file);
     assert.deepEqual(metadata.parents,[parent]);
     posts++;events.push('create');
     return new Response(null,{status:200,headers:{Location:session}});
    }
    assert.equal(opts.method,'PUT');
    const range=opts.headers['Content-Range'];
    if(range==='bytes */'+size){
      events.push('probe');
      return new Response(null,{status:308,
       headers:offset?{Range:'bytes=0-'+(offset-1)}:{}});
    }
    const count=opts.body.length;
    assert.equal(range,`bytes ${offset}-${offset+count-1}/${size}`);
    events.push('upload');uploads++;offset+=count;
    return new Response(null,{status:offset===size?200:308,
     headers:offset<size?{Range:'bytes=0-'+(offset-1)}:{}});
   }
   if(u.pathname==='/drive/v3/files/'+file){
    events.push('remote_get');
    return Response.json({id:file,trashed:false,parents:[parent],
      name:remoteRenamed?'foreign-photo.jpg':plan.name,
      driveId:remoteMoved?'foreign-client-drive':expectedDriveId,
      mimeType:'image/jpeg',size:String(size),sha256Checksum:sha,
      appProperties:plan.appProperties});
   }
   throw Error('Unexpected Google path '+u.pathname);
  }
  assert.equal(u.origin,projectUrl);
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.apikey,serviceRoleJwt);
  assert.equal(opts.headers.Authorization,'Bearer '+serviceRoleJwt);
  assert.equal(u.pathname,'/storage/v1/object/authenticated/fwh-review-private/'+plan.source.object_key);
  const m=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.Range);
  assert.ok(m);
  const start=Number(m[1]),end=Number(m[2]);
  events.push('private_range');
  const actualEnd=shortRange?end-1:end;
  return new Response(bytes.slice(start,actualEnd+1),{status:206,headers:{
   'Content-Type':'image/jpeg',
   'Content-Range':`bytes ${start}-${actualEnd}/${size}`,
   'Content-Length':String(actualEnd-start+1)
  }});
 };
 const run=()=>continueTrustedDeliveryFile({tokenProvider,ledger,workerId:worker,
  generation:gen,packageId:pkg,planId,expectedEmail,expectedDriveId,projectUrl,
  serviceRoleJwt,fetcher,vault});
 return {run,events,
  get totals(){return {posts,uploads,confirmed,offset};}};
}
test('one worker resumes exact private bytes with same remote ID; only independent GET creates file receipt',async()=>{
 const r=rig();
 const first=await r.run();
 assert.equal(first.state,'PROGRESS');
 assert.deepEqual(r.totals,{posts:1,uploads:1,confirmed:0,offset:262144});
 assert.ok(r.events.indexOf('account')<r.events.indexOf('projection'));
 assert.ok(r.events.indexOf('parent')<r.events.indexOf('create'));
 assert.ok(r.events.indexOf('durable_start')<r.events.indexOf('create'));
 assert.ok(r.events.indexOf('persist_session')<r.events.indexOf('private_range'));
 assert.ok(r.events.lastIndexOf('projection')<r.events.indexOf('upload'));
 const second=await r.run();
 assert.equal(second.state,'FILE_VERIFIED');
 assert.deepEqual(r.totals,{posts:1,uploads:2,confirmed:1,offset:300000});
 assert.ok(r.events.lastIndexOf('remote_get')<r.events.lastIndexOf('verify_receipt'));
});
test('wrong OAuth account or wrong client-drive folder prevents any remote create and protected read',async()=>{
 for(const scenario of [{wrongAccount:true},{wrongDrive:true}]){
  const r=rig(scenario);
  await assert.rejects(()=>r.run(),DriveUncertain);
  assert.deepEqual(r.totals,{posts:0,uploads:0,confirmed:0,offset:0});
  assert.equal(r.events.includes('private_range'),false);
 }
});
test('revoked lease or mid-transfer changed file identity fails before sending bytes',async()=>{
 for(const scenario of [{leaseRevoked:true},{planChanged:true}]){
  const r=rig(scenario);
  await assert.rejects(()=>r.run());
  assert.equal(r.totals.uploads,0);
  assert.equal(r.totals.confirmed,0);
  assert.equal(r.totals.offset,0);
  assert.equal(r.events.includes('private_range'),false);
  // Re-projecting the protected source before irreversible remote creation
  // now catches changed plans without consuming even one session-start POST.
  assert.equal(r.totals.posts,0);
 }
});
test('wrong private Storage byte range stops before one-shot Google start or delivery receipt',async()=>{
 const r=rig({shortRange:true});
 await assert.rejects(()=>r.run(),e=>
   e instanceof DriveUncertain&&e.code==='PROTECTED_SOURCE_CHUNK_UNAVAILABLE');
 assert.deepEqual(r.totals,{posts:0,uploads:0,confirmed:0,offset:0});
 assert.equal(r.events.includes('durable_start'),false);
 assert.equal(r.events.includes('persist_session'),false);
});

test('uploaded bytes cannot yield a receipt after remote file rename or shared-drive move',async()=>{
 for(const scenario of [{remoteMoved:true},{remoteRenamed:true}]){
  const r=rig(scenario);
  assert.equal((await r.run()).state,'PROGRESS');
  await assert.rejects(()=>r.run(),e=>e instanceof DriveUncertain
    &&e.code==='REMOTE_FILE_IDENTITY_MISMATCH');
  assert.equal(r.totals.posts,1);
  assert.equal(r.totals.uploads,2);
  assert.equal(r.totals.confirmed,0);
 }
});
