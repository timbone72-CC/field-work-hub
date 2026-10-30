import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {checkPhoto,checkSigned,makeArchive,MAX_PHOTOS,MAX_BYTES}=
  require('../../dashboard/manual-test-export.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),wo=id(2),run=id(3),photo=id(4),version=id(5),revision=id(6);
const origin='https://vyocaujuwrivoqynvitm.supabase.co';
const url=origin+'/storage/v1/object/sign/fwh-review-private/'+
  [org,wo,run,photo+'.jpg'].join('/')+'?token=fixture-only';
const bytes=Uint8Array.from([255,216,255,224,5,8,1,2,3,4,255,217]);
const sha=createHash('sha256').update(bytes).digest('hex');
const receipt={photo_id:photo,run_id:run,transfer_version:version,
  decision_revision:revision,decision:'APPROVED',verified_at:'2026-10-29T00:00:00Z',
  observed_sha256:sha};
const json={photo_id:photo,transfer_version:version,url,expires_in:120};
function fixture({signed=json,body=bytes,mime='image/jpeg',length=bytes.length,
  headStatus=200,getStatus=200,dead=false}={}){
 const calls=[], current=()=>!dead,signer=async p=>{calls.push({kind:'sign',p});return signed;};
 const fetcher=async(u,opts)=>{
   calls.push({url:u,opts});assert.equal(u,url);
   assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');
   assert.equal(opts.cache,'no-store');
   assert.ok(['HEAD','GET'].includes(opts.method));
   const headers={'Content-Type':mime,'Content-Length':String(length)};
   return opts.method==='HEAD'
     ?new Response(null,{status:headStatus,headers})
     :new Response(body,{status:getStatus,headers});
 };
 return {calls,options:{org,wo,origin,signer,fetcher,current}};
}
test('approved exact private receipt creates a bounded, non-delivery TEST ZIP',async()=>{
 const f=fixture();
 const z=await makeArchive([receipt],f.options);
 assert.equal(z.count,1);assert.equal(z.bytes,bytes.length);
 assert.deepEqual(z.hashes,[{photo_id:photo,sha256:sha,size:bytes.length}]);
 assert.equal(z.blob.type,'application/zip');
 const archived=Buffer.from(await z.blob.arrayBuffer());
 assert.equal(archived.toString('utf8',0,2),'PK');
 assert.ok(archived.includes(Buffer.from('manual-test-'+photo+'.jpg')));
 assert.ok(archived.includes(Buffer.from('manual-test-sha256.txt')));
 assert.ok(archived.includes(Buffer.from(sha)));
 assert.ok(archived.includes(Buffer.from('NOT CLIENT DELIVERED')));
 assert.ok(!archived.includes(Buffer.from('fixture-only')));
 assert.deepEqual(f.calls.map(x=>x.kind||x.opts.method),['sign','HEAD','GET']);
});
test('reject pending, rejected, no approval revision, no private receipt, incorrect hash and duplicate',async()=>{
 for(const change of [
  {decision:'PENDING'},{decision:'REJECTED'},{decision_revision:null},
  {observed_sha256:null},{observed_sha256:'a'.repeat(64)},{verified_at:null}
 ]){
   const p={...receipt,...change},f=fixture();
   await assert.rejects(()=>makeArchive([p],f.options));
   if(change.observed_sha256!=='a'.repeat(64))assert.equal(f.calls.length,0);
 }
 const f=fixture();
 await assert.rejects(()=>makeArchive([receipt,receipt],f.options),/Duplicate/);
 assert.equal(f.calls.length,0);
});
test('wrong org, WO, run, file, query, origin and expiry fail before signed byte reads',async()=>{
 for(const bad of [
  {...json,url:url.replace('/'+wo+'/','/'+id(99)+'/')},
  {...json,url:url.replace('/'+run+'/','/'+id(99)+'/')},
  {...json,url:url.replace('/'+org+'/','/'+id(99)+'/')},
  {...json,url:url.replace(photo+'.jpg',id(99)+'.jpg')},
  {...json,url:url+'&download=true'},
  {...json,url:url.replace(origin,'https://other.invalid')},
  {...json,expires_in:1000}
 ]){
   const f=fixture({signed:bad});
   await assert.rejects(()=>makeArchive([receipt],f.options));
   assert.deepEqual(f.calls.map(x=>x.kind),['sign']);
 }
 assert.throws(()=>checkSigned(json,receipt,id(99),wo,origin));
});
test('HTTP errors, wrong content type, short/mismatched byte size and altered JPEG fail closed',async()=>{
 for(const options of [
   {headStatus:403},{getStatus:404},{mime:'text/html'},
   {length:bytes.length+1},{body:Uint8Array.from([255,216,255,0,255,217])},
   {body:Uint8Array.from([1,216,255,224,5,8,1,2,3,4,255,217])},
 ]){
   const f=fixture(options);
   await assert.rejects(()=>makeArchive([receipt],f.options));
 }
});
test('explicit 8 photo and 64 MiB limits, session loss and signer denial never save ZIP',async()=>{
 assert.equal(MAX_PHOTOS,8);assert.equal(MAX_BYTES,64*1024*1024);
 const f=fixture();
 await assert.rejects(()=>makeArchive(Array(9).fill(receipt),f.options),/1–8/);
 assert.equal(f.calls.length,0);
 const dead=fixture({dead:true});
 await assert.rejects(()=>makeArchive([receipt],dead.options),/session/);
 assert.equal(dead.calls.length,0);
});
test('UI remains Admin review-owned; no provider, Send, cleanup or recovery authority',()=>{
 const source=readFileSync(new URL('../../dashboard/private-review.js',import.meta.url),'utf8');
 const helper=readFileSync(new URL('../../dashboard/manual-test-export.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../../dashboard/index.html',import.meta.url),'utf8');
 assert.match(source,/admin_client_choices/);
 assert.match(source,/admin_package_state/);
 assert.match(source,/state\.package/);
 assert.match(source,/admin_review_photo_page/);
 assert.match(source,/p_decision:'APPROVED'/);
 assert.match(source,/checkManualSelection\(photos,wo,token,gen,revision\)/);
 assert.match(source,/FWH TEST CLIENT/);
 assert.match(source,/FWH_MANUAL_TEST_ONLY/);
 assert.match(html,/id="private-review-manual-export"/);
 assert.match(html,/manual-test-export\.js\?v=/);
 assert.doesNotMatch(helper,/admin_queue_package|client_delivery_final_receipts|cleanup_photo|googleapis\.com/);
 assert.doesNotMatch(source,/manual-test.+\bPUT\b/);
});

test('manual TEST download result remains visible after repaint for success or failure',()=>{
  const source=readFileSync(new URL('../../dashboard/private-review.js',import.meta.url),'utf8');
  const render=source.slice(source.indexOf('  function render('),source.indexOf('  async function load('));
  const manual=source.slice(source.indexOf('  async function exportManualTest('),source.indexOf('  function navigate('));
  assert.match(render,/function render\(preserveStatus = false\)/);
  assert.match(render,/if \(!preserveStatus\) status\('No verified photos/);
  assert.match(render,/if \(!preserveStatus\) status\('Only privately verified photos/);
  assert.match(manual,/status\('Verified '\+result\.count/);
  assert.match(manual,/status\('Manual TEST export stopped\./);
  assert.match(manual,/finally\s*\{\s*if\(active\(gen,wo,token\)\)\{manualBusy=false;selectionStatus\(\);render\(true\);\}/);
});

test('ZIP local/central directory and CRC verify exact JPEG plus local-only hash manifest',async()=>{
  const {blob}=await makeArchive([receipt],fixture().options);
  const zip=Buffer.from(await blob.arrayBuffer());
  const end=zip.length-22;
  assert.equal(zip.readUInt32LE(end),0x06054b50);
  assert.equal(zip.readUInt16LE(end+8),2);
  assert.equal(zip.readUInt16LE(end+10),2);
  assert.equal(zip.readUInt32LE(end+12),zip.length-22-zip.readUInt32LE(end+16));
  let at=zip.readUInt32LE(end+16),manifest='';
  const contents=new Map();
  for(let i=0;i<2;i++){
    assert.equal(zip.readUInt32LE(at),0x02014b50);
    assert.equal(zip.readUInt16LE(at+10),0); // stored; no decompression
    const crc=zip.readUInt32LE(at+16),size=zip.readUInt32LE(at+20);
    assert.equal(size,zip.readUInt32LE(at+24));
    const nameLen=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),
      comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42);
    const name=zip.toString('utf8',at+46,at+46+nameLen);
    assert.equal(zip.readUInt32LE(local),0x04034b50);
    assert.equal(zip.readUInt16LE(local+8),0);
    assert.equal(zip.readUInt32LE(local+14),crc);
    assert.equal(zip.readUInt32LE(local+18),size);
    assert.equal(zip.readUInt32LE(local+22),size);
    const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
    const file=zip.subarray(start,start+size);
    assert.equal(file.length,size);
    // Independent CRC-32 check, not a search for ZIP metadata literals.
    let check=0xffffffff;
    for(const b of file){
      check^=b;
      for(let k=0;k<8;k++)check=(check>>>1)^((check&1)?0xedb88320:0);
    }
    assert.equal((check^0xffffffff)>>>0,crc);
    contents.set(name,file);
    at+=46+nameLen+extra+comment;
  }
  assert.equal(at,end);
  assert.deepEqual([...contents.keys()].sort(),[
    'manual-test-'+photo+'.jpg','manual-test-sha256.txt'].sort());
  assert.deepEqual(contents.get('manual-test-'+photo+'.jpg'),Buffer.from(bytes));
  manifest=contents.get('manual-test-sha256.txt').toString('utf8');
  assert.match(manifest,/NOT CLIENT DELIVERED/);
  assert.ok(manifest.includes(photo+'  '+sha+'  '+bytes.length+' bytes'));
  assert.ok(!manifest.includes('fixture-only'));
});
