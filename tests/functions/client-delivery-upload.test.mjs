import test from 'node:test';
import assert from 'node:assert/strict';
import {transferOnePreparedChunk}
 from '../../supabase/functions/client-delivery/upload-one.mjs';
import {DriveUncertain} from '../../supabase/functions/client-delivery/drive-client.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const plan={package_id:uuid(1),plan_id:uuid(2),kind:'PHOTO',
 file_id:'generated_'+'a'.repeat(24),parent_id:'folder_'+'b'.repeat(24),
 name:'001.jpg',mime:'image/jpeg',size:300000,sha256:'a'.repeat(64),
 appProperties:{fwh_package:uuid(1),fwh_manifest:'a'.repeat(64)}};
const workerId=uuid(7),generation=2,expectedDriveId='client_drive_'+'c'.repeat(20);
function rig({failStore=false,failGet=false,failBytes=false,corruptSession=false,
  failStart=false,failBegin=false,beginReply=undefined}={}){
 let entry=null,offset=0,uploaded=0,receipts=0,read=0,started=false;
 const events=[];
 const vault={
  seal:async url=>{events.push('encrypt');return {version:1,nonce:'sealed',payload:'ciphertext'};},
  open:async()=>{events.push('decrypt');if(corruptSession)throw Error('bad AES tag');return 'sealed-url';}
 };
 const ledger={
  heartbeat:async()=>{events.push('heartbeat');},
  getSession:async()=>{
    events.push('get');
    if(started&&!entry)throw new DriveUncertain('UPLOAD_SESSION_START_UNCERTAIN');
    return entry;
  },
  beginSession:async id=>{
    events.push('begin');
    assert.equal(id,plan.plan_id);
    if(started)throw new DriveUncertain('UPLOAD_SESSION_START_UNCERTAIN');
    started=true;
    if(failBegin)throw new DriveUncertain('SERVICE_RPC_OUTCOME_UNCERTAIN');
    return beginReply===undefined
      ? {plan_id:plan.plan_id,start_recorded:true} : beginReply;
  },
  storeSession:async(pkg,worker,gen,id,encrypted)=>{
   events.push('store');if(failStore)throw Error('PERSISTENCE_BLOCKED');
   entry={package_id:pkg,plan_id:id,total_bytes:plan.size,encrypted};
  },
  recordOffset:async(pkg,worker,gen,id,n,complete)=>{
   events.push('offset:'+n+':'+complete);if(n<offset)throw Error('REGRESSION');offset=n;
  },
  confirmFile:async()=>{events.push('confirm');receipts++;}
 };
 const drive={
  startResumable:async()=>{
    events.push('start');
    if(failStart)throw new DriveUncertain('PROVIDER_OUTCOME_UNCERTAIN');
    return {
    session_url:'sealed-url',remote_id:plan.file_id,total:plan.size};},
  probeResumable:async()=>{events.push('probe');return {
    offset,complete_candidate:offset===plan.size};},
  uploadChunk:async(session,total,at,chunk)=>{
    events.push('upload');assert.equal(session,'sealed-url');
    assert.equal(chunk.length,Math.min(262144,plan.size-at));
    uploaded++;offset=at+chunk.length;
    return {complete_candidate:offset===plan.size};},
  verifyFile:async request=>{events.push('verify');
    assert.equal(request.expectedDriveId,expectedDriveId);
    assert.equal(request.name,plan.name);
    assert.equal(request.id,plan.file_id);
    assert.equal(request.parent,plan.parent_id);
    if(failGet)throw new DriveUncertain('REMOTE_CONTENT_UNVERIFIED');
    return {id:plan.file_id,parent:plan.parent_id,sha256:plan.sha256,size:plan.size};}
 };
 const readProtectedChunk=async(file,at,size)=>{
  events.push('read');read++;
  assert.equal(file,plan);return new Uint8Array(failBytes?size-1:size);
 };
 return {vault,ledger,drive,readProtectedChunk,events,
  get counters(){return {uploaded,receipts,read,offset};},set entry(v){entry=v;}};
}
const invoke=r=>transferOnePreparedChunk({plan,workerId,generation,
 drive:r.drive,ledger:r.ledger,vault:r.vault,readProtectedChunk:r.readProtectedChunk,
 expectedDriveId});
test('persist ciphertext before any remote photo bytes; bounded resume finishes by independent GET',async()=>{
 const r=rig();
 const first=await invoke(r);
 assert.deepEqual(first,{state:'PROGRESS',plan_id:plan.plan_id,
  recorded_offset:262144,total:300000});
 assert.ok(r.events.indexOf('begin')<r.events.indexOf('start'));
 assert.ok(r.events.indexOf('start')<r.events.indexOf('store'));
 assert.ok(r.events.indexOf('store')<r.events.indexOf('read'));
 assert.ok(r.events.indexOf('encrypt')<r.events.indexOf('store'));
 assert.equal(r.counters.receipts,0);
 const second=await invoke(r);
 assert.equal(second.state,'FILE_VERIFIED');
 assert.equal(r.counters.uploaded,2);
 assert.equal(r.counters.receipts,1);
 assert.equal(r.counters.offset,300000);
 assert.equal(r.events.filter(e=>e==='start').length,1);
 assert.ok(r.events.indexOf('verify')<r.events.indexOf('confirm'));
});
test('failed session persistence prevents any prepared-byte read or upload',async()=>{
 const r=rig({failStore:true});
 await assert.rejects(()=>invoke(r),/PERSISTENCE_BLOCKED/);
 assert.equal(r.counters.read,0);assert.equal(r.counters.uploaded,0);
 assert.equal(r.counters.receipts,0);
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='UPLOAD_SESSION_START_UNCERTAIN');
 assert.equal(r.events.filter(e=>e==='start').length,1);
});
test('uncertain Google session-start is durably fenced before any repeated POST',async()=>{
 const r=rig({failStart:true});
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='PROVIDER_OUTCOME_UNCERTAIN');
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='UPLOAD_SESSION_START_UNCERTAIN');
 assert.equal(r.events.filter(e=>e==='begin').length,1);
 assert.equal(r.events.filter(e=>e==='start').length,1);
 assert.equal(r.counters.uploaded,0);
 assert.equal(r.counters.receipts,0);
});
test('lost SQL begin response cannot start a Google session and stays frozen',async()=>{
 const r=rig({failBegin:true});
 await assert.rejects(()=>invoke(r),e=>e instanceof DriveUncertain
   &&e.code==='SERVICE_RPC_OUTCOME_UNCERTAIN');
 await assert.rejects(()=>invoke(r),e=>e instanceof DriveUncertain
   &&e.code==='UPLOAD_SESSION_START_UNCERTAIN');
 assert.equal(r.events.filter(x=>x==='start').length,0);
 assert.equal(r.counters.read,0);
});
test('a successful HTTP code without exact committed SQL start acknowledgement cannot contact Google',async()=>{
 for(const beginReply of [null,{}, {plan_id:plan.plan_id,start_recorded:false},
   {plan_id:uuid(98),start_recorded:true},{plan_id:plan.plan_id,start_recorded:'true'}]){
  const r=rig({beginReply});
  await assert.rejects(()=>invoke(r),e=>e instanceof DriveUncertain
    &&e.code==='UPLOAD_SESSION_START_UNCONFIRMED');
  await assert.rejects(()=>invoke(r),e=>e instanceof DriveUncertain
    &&e.code==='UPLOAD_SESSION_START_UNCERTAIN');
  assert.equal(r.events.filter(x=>x==='start').length,0);
  assert.equal(r.counters.uploaded,0);
  assert.equal(r.counters.receipts,0);
 }
});
test('missing durable start RPC refuses Google POST and prepared bytes',async()=>{
 const r=rig();
 delete r.ledger.beginSession;
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='UPLOAD_SESSION_START_FENCE_REQUIRED');
 assert.equal(r.events.includes('start'),false);
 assert.equal(r.counters.read,0);
});
test('unreadable session is protected UNCERTAIN, not replaced with a new ID or session',async()=>{
 const r=rig({corruptSession:true});
 r.entry={package_id:plan.package_id,plan_id:plan.plan_id,total_bytes:plan.size,
   encrypted:{version:1,nonce:'x',payload:'y'}};
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='JOURNAL_DECRYPTION_FAILED');
 assert.equal(r.events.includes('start'),false);
 assert.equal(r.counters.read,0);
});
test('missing or altered prepared source bytes never leave original protected evidence',async()=>{
 const r=rig({failBytes:true});
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='PROTECTED_SOURCE_CHUNK_UNAVAILABLE');
 assert.equal(r.counters.uploaded,0);assert.equal(r.counters.receipts,0);
});
test('a complete upload response is only a candidate until independent checksum GET',async()=>{
 const r=rig({failGet:true});
 await invoke(r);
 await assert.rejects(()=>invoke(r),e=>
   e instanceof DriveUncertain&&e.code==='REMOTE_CONTENT_UNVERIFIED');
 assert.equal(r.counters.uploaded,2);assert.equal(r.counters.receipts,0);
});

test('no client Shared Drive binding refuses provider session/bytes and durable receipt',async()=>{
 const r=rig();
 await assert.rejects(()=>transferOnePreparedChunk({plan,workerId,generation,
   drive:r.drive,ledger:r.ledger,vault:r.vault,readProtectedChunk:r.readProtectedChunk}),
  e=>e instanceof DriveUncertain&&e.code==='EXACT_PREALLOCATED_FILE_REQUIRED');
 assert.deepEqual(r.events,[]);
 assert.equal(r.counters.uploaded,0);
 assert.equal(r.counters.receipts,0);
});
test('Google moving or renaming an otherwise matching file cannot confirm delivery',async()=>{
 for(const violation of ['foreign_drive','wrong_name']){
  const r=rig();
  r.drive.verifyFile=async params=>{
    r.events.push('verify');
    assert.equal(params.expectedDriveId,expectedDriveId);
    assert.equal(params.name,plan.name);
    throw new DriveUncertain('REMOTE_FILE_IDENTITY_MISMATCH');
  };
  await invoke(r);
  await assert.rejects(()=>invoke(r),e=>e instanceof DriveUncertain
    &&e.code==='REMOTE_FILE_IDENTITY_MISMATCH');
  assert.equal(r.counters.receipts,0,violation);
 }
});
