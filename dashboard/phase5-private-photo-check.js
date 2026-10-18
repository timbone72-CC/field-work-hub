/* One-off Phase 5 TEST-only received-photo byte/range gate.
 * Uses the CURRENT TAB'S normal Admin session, not copied JWTs.
 * No photo IDs, tokens, signed URLs, or protected JPEGs leave this browser.
 * Only existing read-only work list, photo page, signer, and signed byte GETs.
 * No database change, upload, delivery, worker, phone, permission, or cleanup.
 */
(function(root){
'use strict';
const HOST='https://vyocaujuwrivoqynvitm.supabase.co';
const KEY='sb_publishable_UPmj_Y10-mLwJo7soekCpg_BYZ08LNZ';
const BUCKET='fwh-review-private';
const MAX=32*1024*1024,CHUNK=256*1024;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const denySet=new Set([401,403,404]);
const err=code=>{const e=new Error(code);e.code=code;throw e;};
async function call(fetcher,url,opts={}){
 try{return await fetcher(url,{...opts,redirect:'error',credentials:'omit',cache:'no-store',
   signal:AbortSignal.timeout(20000)});}
 catch{err('NETWORK_UNAVAILABLE');}
}
async function json(res,limit=12000){
 if(!res.ok)err('AUTHORIZED_READ_DENIED');
 try{
   const raw=await res.text();
   if(raw.length>limit)err('UNTRUSTED_RESPONSE');
   return JSON.parse(raw);
 }catch{err('UNTRUSTED_RESPONSE');}
}
function sessionToken(storage){
 let raw;
 try{raw=JSON.parse(storage.getItem('fppTeamAdmin.tabAuthSession')||'null');}
 catch{err('SIGN_IN_TO_TEST_DASHBOARD');}
 const token=raw?.access_token;
 if(typeof token!=='string'||token.length<20)err('SIGN_IN_TO_TEST_DASHBOARD');
 // This is input consistency, not authority. Auth and scoped RPC recheck every request.
 try{
   const payload=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   if(payload.role!=='authenticated'||!UUID.test(payload.sub??'')
     ||!UUID.test(payload.session_id??'')
     ||!UUID.test(payload.app_metadata?.organization_id??'')
     ||payload.app_metadata?.role!=='ADMIN'
     ||!Number.isInteger(payload.exp)||payload.exp<=Math.floor(Date.now()/1000)+60)
     err('SIGN_IN_TO_TEST_DASHBOARD');
   return {token,claims:payload};
 }catch(e){if(e.code)throw e;err('SIGN_IN_TO_TEST_DASHBOARD');}
}
function exactSignedURL(location,path){
 if(typeof location!=='string'||location.length>3500)err('INVALID_SIGNED_URL');
 let u;try{u=new URL(location);}catch{err('INVALID_SIGNED_URL');}
 if(u.origin!==HOST||u.username||u.password||u.hash
   ||u.pathname!=='/storage/v1/object/sign/'+BUCKET+'/'+path
   ||u.searchParams.size!==1||!u.searchParams.get('token'))
   err('INVALID_SIGNED_URL');
 return u.toString();
}
async function readRanges(fetcher,url,expectedHash,hashBytes){
 const pieces=[];let size=null;
 for(let at=0;size===null||at<size;at+=CHUNK){
   const end=size===null?CHUNK-1:Math.min(at+CHUNK,size)-1;
   const res=await call(fetcher,url,{method:'GET',headers:{
     Range:'bytes='+at+'-'+end,Accept:'image/jpeg',
     'Accept-Encoding':'identity'}});
   if(res.status!==206)err('RANGE_206_UNSUPPORTED');
   const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range')||'');
   if(!m||Number(m[1])!==at||Number(m[2])!==end)
     err('RANGE_IDENTITY_MISMATCH');
   const total=Number(m[3]);
   if(!Number.isSafeInteger(total)||total<=CHUNK||total>MAX
      ||(size!==null&&total!==size)||end>=total)
     err('RANGE_IDENTITY_MISMATCH');
   size=total;
   const mime=(res.headers.get('Content-Type')||'').split(';')[0].toLowerCase().trim();
   if(mime!=='image/jpeg'
     ||!['','identity'].includes(res.headers.get('Content-Encoding')||'')
     ||(res.headers.has('Content-Length')&&res.headers.get('Content-Length')!==String(end-at+1)))
     err('RANGE_IDENTITY_MISMATCH');
   const bytes=new Uint8Array(await res.arrayBuffer());
   if(bytes.length!==end-at+1)err('RANGE_BYTE_MISMATCH');
   pieces.push(bytes);
 }
 const all=new Uint8Array(size);let pos=0;
 for(const b of pieces){all.set(b,pos);pos+=b.length;}
 if(pos!==size)err('RANGE_BYTE_MISMATCH');
 const actual=await hashBytes(all);
 if(actual!==expectedHash)err('SHA256_RECEIPT_MISMATCH');
 return {bytes:size,ranges:pieces.length};
}
async function verifyBrowserPrivatePhoto({fetcher,storage,hashBytes,status=()=>{}}){
 if(typeof fetcher!=='function'||typeof hashBytes!=='function'
    ||typeof storage?.getItem!=='function')err('TEST_RUNTIME_UNAVAILABLE');
 const {token,claims}=sessionToken(storage);
 const headers={apikey:KEY,Authorization:'Bearer '+token};
 status('Checking the current Admin permission and existing TEST work order…');
 const user=await json(await call(fetcher,HOST+'/auth/v1/user',{headers,method:'GET'}));
 if(user.id!==claims.sub||user.app_metadata?.role!=='ADMIN'
   ||user.app_metadata?.organization_id!==claims.app_metadata.organization_id)
   err('SIGN_IN_TO_TEST_DASHBOARD');
 const work=await json(await call(fetcher,HOST+
   '/rest/v1/work_orders?select=id,organization_id,wo_number,property_address'+
   '&wo_number=eq.TEST-0003-DASHBOARD&limit=2',{method:'GET',headers}));
 if(!Array.isArray(work)||work.length!==1
   ||work[0].wo_number!=='TEST-0003-DASHBOARD'
   ||work[0].property_address!=='TEST ONLY - 300 Test Property Rd'
   ||work[0].organization_id!==claims.app_metadata.organization_id
   ||!UUID.test(work[0].id))err('TEST_WORK_ORDER_UNAVAILABLE');
 const wo=work[0];
 const body={p_wo:wo.id,p_limit:25,p_after_sequence:null,p_after_photo:null,
   p_run:null,p_item:null,p_extra:false,p_stage:null,p_decision:'APPROVED'};
 const page=await json(await call(fetcher,HOST+'/rest/v1/rpc/admin_review_photo_page',{
   method:'POST',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify(body)}),25000);
 if(page.work_order_id!==wo.id||!Array.isArray(page.photos)
   ||page.photos.length>25||page.photos.length===0)err('TEST_PHOTO_NOT_AVAILABLE');
 const photos=page.photos.filter(item=>UUID.test(item.photo_id||'')
   &&UUID.test(item.transfer_version||'')&&UUID.test(item.run_id||'')
   &&HASH.test(item.observed_sha256||'')&&item.decision==='APPROVED');
 if(photos.length===0)err('TEST_PHOTO_NOT_AVAILABLE');
 const selected=photos[0];
 const objectKey=[wo.organization_id,wo.id,selected.run_id,selected.photo_id+'.jpg']
   .map(encodeURIComponent).join('/');
 const direct=HOST+'/storage/v1/object/authenticated/'+BUCKET+'/'+objectKey;
 const signer=HOST+'/functions/v1/admin-private-photo';
 status('Checking anonymous access denial without exposing photo bytes…');
 const anon=await call(fetcher,direct,{method:'GET',headers:{
   apikey:KEY,Range:'bytes=0-0',Accept:'image/jpeg'}});
 if(!denySet.has(anon.status))err('ANONYMOUS_STORAGE_ACCESS_NOT_DENIED');
 await anon.body?.cancel().catch(()=>{});
 const req={photo_id:selected.photo_id,transfer_version:selected.transfer_version};
 const anonymousSigner=await call(fetcher,signer,{method:'POST',
   headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(req)});
 if(!denySet.has(anonymousSigner.status))err('ANONYMOUS_SIGNER_ACCESS_NOT_DENIED');
 await anonymousSigner.body?.cancel().catch(()=>{});
 status('Requesting an authorized, short-lived private preview…');
 const signed=await json(await call(fetcher,signer,{method:'POST',
   headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(req)}));
 if(signed.photo_id!==req.photo_id||signed.transfer_version!==req.transfer_version
   ||!Number.isInteger(signed.expires_in)||signed.expires_in<1||signed.expires_in>120)
   err('INVALID_SIGNED_URL');
 const exact=exactSignedURL(signed.url,objectKey);
 status('Checking every returned JPEG byte and the immutable SHA-256 receipt…');
 const range=await readRanges(fetcher,exact,selected.observed_sha256,hashBytes);
 // No token, selected UUID, URL, hash, JPEG, or user ID is returned or logged.
 return {verified:true,anonymous_storage:'DENIED',anonymous_signer:'DENIED',
   authorized_admin:'PASS',sha256:'MATCH',partial_206:'PASS',
   ranges:range.ranges,bytes:range.bytes,foreign_user:'NOT_TESTED',
   original_owner_direct:'NOT_TESTED',delivery:'DISABLED'};
}
if(typeof module!=='undefined'&&module.exports)
 module.exports={verifyBrowserPrivatePhoto,readRanges,exactSignedURL};
if(root&&root.document&&root.location){
 const ready=()=>{
   const button=root.document.getElementById('run-test');
   const output=root.document.getElementById('test-result');
   if(!button||!output)return;
   const current=root.location.pathname;
   if(current!=='/field-work-hub/phase56-review/phase5-private-photo-check.html'){
     output.textContent='BLOCKED: TEST_PREVIEW_ONLY';button.disabled=true;return;
   }
   button.addEventListener('click',async()=>{
     button.disabled=true;output.textContent='Checking private TEST photo…';
     try{
       const result=await verifyBrowserPrivatePhoto({
         fetcher:root.fetch.bind(root),storage:root.sessionStorage,
         hashBytes:async bytes=>{
           const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
           return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
         },status:msg=>{output.textContent=msg;}
       });
       output.textContent='PASS: Received TEST photo verified. '+result.bytes+
         ' bytes, '+result.ranges+' HTTP 206 ranges, SHA-256 match. '+
         'Anonymous Storage and signer denied. Foreign-user denial remains pending. '+
         'No photo change or Send.';
     }catch(e){
       const allow=new Set(['SIGN_IN_TO_TEST_DASHBOARD','TEST_RUNTIME_UNAVAILABLE',
         'TEST_WORK_ORDER_UNAVAILABLE','TEST_PHOTO_NOT_AVAILABLE','NETWORK_UNAVAILABLE',
         'AUTHORIZED_READ_DENIED','UNTRUSTED_RESPONSE','INVALID_SIGNED_URL',
         'RANGE_206_UNSUPPORTED','RANGE_IDENTITY_MISMATCH','RANGE_BYTE_MISMATCH',
         'SHA256_RECEIPT_MISMATCH','ANONYMOUS_STORAGE_ACCESS_NOT_DENIED',
         'ANONYMOUS_SIGNER_ACCESS_NOT_DENIED']);
       output.textContent='BLOCKED: '+(allow.has(e.code)?e.code:'PRIVATE_TEST_UNVERIFIED')+
         '. No photo or delivery change.';
     }finally{button.disabled=false;}
   });
 };
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',ready);
 else ready();
}
})(typeof window!=='undefined'?window:null);
