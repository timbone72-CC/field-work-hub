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
const workerId=uuid(7),generation=2;
function rig({failStore=false,failGet=false,failBytes=false,corruptSession=false}={}){
 let entry=null,offset=0,uploaded=0,receipts=0,read=0;
 const events=[];
 const vault={
  seal:async url=>{events.push('encrypt');return {version:1,nonce:'sealed',payload:'ciphertext'};},
  open:async()=>{events.push('decrypt');if(corruptSession)throw Error('bad AES tag');return 'sealed-url';}
 };
 const ledger={
  heartbeat:async()=>{events.push('heartbeat');},
  getSession:async()=>{events.push('get');return entry;},
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
  startResumable:async()=>{events.push('start');return {
    session_url:'sealed-url',remote_id:plan.file_id,total:plan.size};},
  probeResumable:async()=>{events.push('probe');return {
    offset,complete_candidate:offset===plan.size};},
  uploadChunk:async(session,total,at,chunk)=>{
    events.push('upload');assert.equal(session,'sealed-url');
    assert.equal(chunk.length,Math.min(262144,plan.size-at));
    uploaded++;offset=at+chunk.length;
    return {complete_candidate:offset===plan.size};},
  verifyFile:async()=>{events.push('verify');
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
 drive:r.drive,ledger:r.ledger,vault:r.vault,readProtectedChunk:r.readProtectedChunk});
test('persist ciphertext before any remote photo bytes; bounded resume finishes by independent GET',async()=>{
 const r=rig();
 const first=await invoke(r);
 assert.deepEqual(first,{state:'PROGRESS',plan_id:plan.plan_id,
  recorded_offset:262144,total:300000});
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
