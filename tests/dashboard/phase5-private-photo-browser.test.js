import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyBrowserPrivatePhoto}=require('../../dashboard/phase5-private-photo-check.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),wo=id(2),run=id(3),photo=id(4),version=id(5),user=id(6),session=id(7);
const host='https://vyocaujuwrivoqynvitm.supabase.co',bucket='fwh-review-private';
const objectKey=[org,wo,run,photo+'.jpg'].join('/');
const token=['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({
 sub:user,role:'authenticated',session_id:session,exp:4102444800,
 app_metadata:{role:'ADMIN',organization_id:org}
})).toString('base64url'),'mock-test-only'].join('.');
const bytes=Uint8Array.from({length:400003},(_,i)=>i%241);
const hash=createHash('sha256').update(bytes).digest('hex');
const signedUrl=host+'/storage/v1/object/sign/'+bucket+'/'+objectKey+'?token=test-short-lived';
const makeJson=(v,status=200)=>new Response(JSON.stringify(v),{
 status,headers:{'Content-Type':'application/json'}});
function rig({anon=403,anonSign=401,admin=200,range=206,
 corrupt=false,wrongRange=false,wrongAccount=false,wrongWork=false,
 wrongPhotoHash=false,noToken=false,wrongSigned=false,
 hideRange=false,headStatus=200,headSizeOffset=0,headMime='image/jpeg'}={}){
 const requests=[],status=[];
 const adminToken=noToken?null:token;
 const fetcher=async (url,opts={})=>{
   const u=String(url);requests.push({url:u,method:opts.method,headers:opts.headers});
   assert.equal(opts.credentials,'omit');
   assert.equal(opts.redirect,'error');
   if(u.includes('/auth/v1/user'))return makeJson({
     id:wrongAccount?id(99):user,
     app_metadata:{role:'ADMIN',organization_id:org}});
   if(u.includes('/rest/v1/work_orders?'))return makeJson([{
     id:wo,organization_id:org,wo_number:'TEST-0003-DASHBOARD',
     property_address:wrongWork?'customer address':'TEST ONLY - 300 Test Property Rd'
   }]);
   if(u.includes('/rest/v1/rpc/admin_review_photo_page')){
     assert.equal(opts.method,'POST');
     return makeJson({work_order_id:wo,photos:[{
       photo_id:photo,run_id:run,transfer_version:version,
       observed_sha256:wrongPhotoHash?'a'.repeat(64):hash,decision:'APPROVED'
     }]});
   }
   if(u.includes('/object/authenticated/'))return makeJson({error:'denied'},anon);
   if(u.endsWith('/functions/v1/admin-private-photo')){
     if(!opts.headers.Authorization)return makeJson({error:'denied'},anonSign);
     return admin===200?makeJson({photo_id:photo,transfer_version:version,
       url:wrongSigned?signedUrl.replace('test-short-lived','invalid'):signedUrl,
       expires_in:120}):makeJson({error:'denied'},admin);
   }
   assert.equal(u,signedUrl);
   if(opts.method==='HEAD'){
     return new Response(null,{status:headStatus,headers:{
       'Content-Type':headMime,'Content-Length':String(bytes.length+headSizeOffset)}});
   }
   const m=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.Range);
   assert.ok(m);const begin=Number(m[1]),end=Number(m[2]);
   const rangeBytes=bytes.slice(begin,end+1);
   if(corrupt&&begin===0)rangeBytes[0]^=1;
   return new Response(rangeBytes,{status:range,headers:{
     'Content-Type':'image/jpeg','Content-Length':String(rangeBytes.length),
     ...(!hideRange?{'Content-Range':'bytes '+begin+'-'+
       (wrongRange?end+1:end)+'/'+bytes.length}:{})
   }});
 };
 return {config:{fetcher,adminToken,
   hashBytes:async b=>createHash('sha256').update(b).digest('hex'),
   status:message=>status.push(message)},requests,status};
}
test('signed-in TEST dashboard route hashes exact 2 ranged JPEG chunks without token copying',async()=>{
 const r=rig();
 const out=await verifyBrowserPrivatePhoto(r.config);
 assert.deepEqual(out,{verified:true,private_bytes_verified:true,
   anonymous_storage:'DENIED',anonymous_signer:'DENIED',
   authorized_admin:'PASS',sha256:'MATCH',
   partial_206:'PASS',content_range:'VERIFIED',
   ranges:2,bytes:bytes.length,
   foreign_user:'NOT_TESTED',original_owner_direct:'NOT_TESTED',
   delivery:'DISABLED'});
 assert.equal(r.requests.filter(x=>x.method==='GET'&&x.url===signedUrl).length,2);
 assert.equal(r.requests.some(x=>x.url.includes('?token=test-short-lived')&&
   x.headers?.Authorization),false);
 assert.equal(JSON.stringify(out).includes(token),false);
 assert.equal(JSON.stringify(out).includes(signedUrl),false);
});
test('missing browser session fails before any server or byte reads',async()=>{
 const r=rig({noToken:true});
 await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
   e=>e.code==='SIGN_IN_TO_TEST_DASHBOARD');
 assert.equal(r.requests.length,0);
});
test('wrong signed-in account or non-TEST WO never requests signed photo',async()=>{
 for(const opt of [{wrongAccount:true},{wrongWork:true}]){
   const r=rig(opt);await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config));
   assert.equal(r.requests.some(x=>x.url.includes('/admin-private-photo')),false);
 }
});
test('anonymous raw or signer exposure blocks before any authorized signed bytes',async()=>{
 for(const opt of [{anon:200},{anonSign:200}]){
  const r=rig(opt);await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config));
  assert.equal(r.requests.filter(x=>x.url===signedUrl).length,0);
 }
});
test('server signer denial does not pretend photo was verified',async()=>{
 const r=rig({admin:403});
 await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
   e=>e.code==='AUTHORIZED_READ_DENIED');
 assert.equal(r.requests.filter(x=>x.url===signedUrl).length,0);
});
test('HTTP 200 instead of 206 or wrong Content-Range blocks verification',async()=>{
 for(const opt of [{range:200},{wrongRange:true}]){
   const r=rig(opt);await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config));
 }
});
test('altered private bytes or changed approved receipt hash blocks',async()=>{
 for(const opt of [{corrupt:true},{wrongPhotoHash:true}]){
   const r=rig(opt);
   await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
     e=>e.code==='SHA256_RECEIPT_MISMATCH');
 }
});
test('live-observed anonymous Storage 400 is a rejected request, not falsely called exposure or denial PASS',async()=>{
 const r=rig({anon:400});
 const out=await verifyBrowserPrivatePhoto(r.config);
 assert.equal(out.private_bytes_verified,true);
 assert.equal(out.verified,false);
 assert.equal(out.anonymous_storage,'REJECTED_400_UNVERIFIED');
 assert.equal(out.anonymous_signer,'DENIED');
 assert.equal(out.sha256,'MATCH');
 assert.equal(out.partial_206,'PASS');
 assert.equal(r.requests.filter(x=>x.url===signedUrl&&x.method==='GET').length,2);
});
test('400 from anonymous signer remains unverified despite successful authenticated bytes',async()=>{
 const r=rig({anonSign:400});
 const out=await verifyBrowserPrivatePhoto(r.config);
 assert.equal(out.verified,false);
 assert.equal(out.anonymous_storage,'DENIED');
 assert.equal(out.anonymous_signer,'REJECTED_400_UNVERIFIED');
 assert.equal(out.private_bytes_verified,true);
});
test('5xx/429 anonymous responses block without claiming denial or running signed reads',async()=>{
 for(const options of [{anon:500},{anon:429},{anonSign:503}]){
   const r=rig(options);
   await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
     e=>['ANONYMOUS_STORAGE_ACCESS_STATUS_UNVERIFIED',
         'ANONYMOUS_SIGNER_ACCESS_STATUS_UNVERIFIED'].includes(e.code));
   assert.equal(r.requests.filter(x=>x.url===signedUrl).length,0);
 }
});
test('actual successful anonymous 2xx response signals exposure and blocks all later reads',async()=>{
 for(const options of [{anon:200},{anon:206},{anonSign:200}]){
   const r=rig(options);
   await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
      e=>['ANONYMOUS_STORAGE_ACCESS_EXPOSED',
         'ANONYMOUS_SIGNER_ACCESS_EXPOSED'].includes(e.code));
   assert.equal(r.requests.filter(x=>x.url===signedUrl).length,0);
 }
});
test('actual Chrome-style CORS hidden Content-Range verifies exact bytes but never claims full PASS',async()=>{
 const r=rig({hideRange:true,anon:400});
 const out=await verifyBrowserPrivatePhoto(r.config);
 assert.equal(out.private_bytes_verified,true);
 assert.equal(out.partial_206,'PASS');
 assert.equal(out.sha256,'MATCH');
 assert.equal(out.content_range,'NOT_EXPOSED');
 assert.equal(out.anonymous_storage,'REJECTED_400_UNVERIFIED');
 assert.equal(out.verified,false);
 assert.equal(r.requests.filter(x=>x.url===signedUrl&&x.method==='HEAD').length,1);
 assert.equal(r.requests.filter(x=>x.url===signedUrl&&x.method==='GET').length,2);
});
test('CORS hidden Content-Range with all other checks denied remains partial, not false PASS',async()=>{
 const r=rig({hideRange:true});
 const out=await verifyBrowserPrivatePhoto(r.config);
 assert.equal(out.content_range,'NOT_EXPOSED');
 assert.equal(out.anonymous_storage,'DENIED');
 assert.equal(out.anonymous_signer,'DENIED');
 assert.equal(out.private_bytes_verified,true);
 assert.equal(out.verified,false);
});
test('no independent HEAD size or wrong content type blocks BEFORE any ranged reads',async()=>{
 for(const opt of [
   {headStatus:403},{headSizeOffset:1},{headMime:'application/octet-stream'}
 ]){
   const r=rig(opt);
   await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
     e=>['SIGNED_HEAD_NOT_AVAILABLE','SIGNED_HEAD_IDENTITY_UNVERIFIED',
          'RANGE_IDENTITY_MISMATCH','RANGE_BYTE_MISMATCH'].includes(e.code));
   if(opt.headSizeOffset!==1)
     assert.equal(r.requests.filter(x=>x.url===signedUrl&&x.method==='GET').length,0);
 }
});
test('browser-hidden Content-Range never permits a changed photo SHA-256',async()=>{
 const r=rig({hideRange:true,corrupt:true});
 await assert.rejects(()=>verifyBrowserPrivatePhoto(r.config),
   e=>e.code==='SHA256_RECEIPT_MISMATCH');
});
test('all request methods are reads or authorized read-only POST, never Send',async()=>{
 const r=rig();await verifyBrowserPrivatePhoto(r.config);
 assert.equal(r.requests.some(x=>!['GET','HEAD','POST'].includes(x.method)),false);
 assert.equal(r.requests.some(x=>/send|upload|create|delete|activate|cleanup|grant/i.test(x.url)),false);
 assert.equal(r.requests.filter(x=>x.method==='POST').length,3);
});

test('browser summary keeps distinct-company security evidence separate from this read-only byte check',()=>{
 const ui=readFileSync(new URL('../../dashboard/phase5-private-photo-check.js',import.meta.url),'utf8');
 assert.match(ui,/This button did not recheck a separate user/);
 assert.match(ui,/separately recorded TEST company-denial gate/);
 assert.doesNotMatch(ui,/Foreign-user check remains pending/);
});
