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
// Security evidence must distinguish successful photo bytes (exposure), verified
// authorization denial, rejected malformed/unresolved requests, and outages.
// A Storage 400 NoSuchKey is neither a public-read success nor RLS denial proof.
async function anonymousAccess(response,subject){
 const status=response.status;
 await response.body?.cancel().catch(()=>{});
 if(denySet.has(status))return 'DENIED';
 if(status===400)return 'REJECTED_400_UNVERIFIED';
 if(status>=200&&status<300)err('ANONYMOUS_'+subject+'_EXPOSED');
 err('ANONYMOUS_'+subject+'_STATUS_UNVERIFIED');
}
async function json(res,limit=12000){
 if(!res.ok)err('AUTHORIZED_READ_DENIED');
 try{
   const raw=await res.text();
   if(raw.length>limit)err('UNTRUSTED_RESPONSE');
   return JSON.parse(raw);
 }catch{err('UNTRUSTED_RESPONSE');}
}
function sessionToken(token){
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
 // CORS may hide Content-Range even when Supabase sends it correctly.
 // Obtain the same signed object's full size with read-only HEAD; this
 // cannot return photo bytes or invent a privileged path.
 const head=await call(fetcher,url,{method:'HEAD',headers:{Accept:'image/jpeg'}});
 if(head.status!==200){await head.body?.cancel().catch(()=>{});err('SIGNED_HEAD_NOT_AVAILABLE');}
 const size=Number(head.headers.get('Content-Length'));
 const headMime=(head.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 await head.body?.cancel().catch(()=>{});
 if(!Number.isSafeInteger(size)||size<=CHUNK||size>MAX||headMime!=='image/jpeg')
   err('SIGNED_HEAD_IDENTITY_UNVERIFIED');
 const all=new Uint8Array(size);
 let count=0,parts=0,rangeHeadersVerified=true;
 for(let at=0;at<size;at+=CHUNK){
   const end=Math.min(at+CHUNK,size)-1,need=end-at+1;
   const res=await call(fetcher,url,{method:'GET',headers:{
     Range:'bytes='+at+'-'+end,Accept:'image/jpeg','Accept-Encoding':'identity'}});
   if(res.status!==206){await res.body?.cancel().catch(()=>{});err('RANGE_206_UNSUPPORTED');}
   const rawRange=res.headers.get('Content-Range');
   if(rawRange!==null){
     const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(rawRange);
     if(!m||Number(m[1])!==at||Number(m[2])!==end||Number(m[3])!==size)
       err('RANGE_IDENTITY_MISMATCH');
   }else{
     // Missing CORS-exposed header is NOT a verified header match.
     rangeHeadersVerified=false;
   }
   const mime=(res.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
   if(mime!=='image/jpeg'
     ||!['','identity'].includes(res.headers.get('Content-Encoding')||'')
     ||(res.headers.has('Content-Length')&&res.headers.get('Content-Length')!==String(need)))
     err('RANGE_IDENTITY_MISMATCH');
   if(!res.body)err('RANGE_BYTE_MISMATCH');
   const reader=res.body.getReader();let got=0;
   try{
     while(true){
       const {done,value}=await reader.read();if(done)break;
       if(!(value instanceof Uint8Array)||got+value.length>need)
         err('RANGE_BYTE_MISMATCH');
       all.set(value,at+got);got+=value.length;
     }
   }catch(e){if(e.code)throw e;err('NETWORK_UNAVAILABLE');}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   if(got!==need)err('RANGE_BYTE_MISMATCH');
   count+=got;parts++;
 }
 if(count!==size)err('RANGE_BYTE_MISMATCH');
 const actual=await hashBytes(all);
 if(actual!==expectedHash)err('SHA256_RECEIPT_MISMATCH');
 return {bytes:size,ranges:parts,
   content_range:rangeHeadersVerified?'VERIFIED':'NOT_EXPOSED'};
}
async function verifyBrowserPrivatePhoto({fetcher,adminToken,hashBytes,status=()=>{}}){
 if(typeof fetcher!=='function'||typeof hashBytes!=='function')
   err('TEST_RUNTIME_UNAVAILABLE');
 const {token,claims}=sessionToken(adminToken);
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
 const anonymousStorage=await anonymousAccess(anon,'STORAGE_ACCESS');
 const req={photo_id:selected.photo_id,transfer_version:selected.transfer_version};
 const anonymousSigner=await call(fetcher,signer,{method:'POST',
   headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(req)});
 const anonymousSignerResult=await anonymousAccess(anonymousSigner,'SIGNER_ACCESS');
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
 return {verified:anonymousStorage==='DENIED'&&anonymousSignerResult==='DENIED'
     &&range.content_range==='VERIFIED',
   private_bytes_verified:true,
   anonymous_storage:anonymousStorage,anonymous_signer:anonymousSignerResult,
   authorized_admin:'PASS',sha256:'MATCH',partial_206:'PASS',
   content_range:range.content_range,
   ranges:range.ranges,bytes:range.bytes,foreign_user:'NOT_TESTED',
   original_owner_direct:'NOT_TESTED',delivery:'DISABLED'};
}
if(typeof module!=='undefined'&&module.exports)
 module.exports={verifyBrowserPrivatePhoto,readRanges,exactSignedURL};
// TEST opt-in is mounted in the existing authenticated dashboard.
// The existing app/session owner supplies an in-memory access token.
if(root&&root.document&&root.location){
 const ready=()=>{
   const path=root.location.pathname;
   if(path!=='/field-work-hub/phase56-review/' ||
     new URLSearchParams(root.location.search).get('phase5PrivatePhotoTest')!=='1')
     return;
   const host=root.document.querySelector('main');
   if(!host)return;
   const panel=root.document.createElement('section');
   panel.id='phase5-private-photo-test';
   panel.style.cssText='margin:12px auto;padding:16px;max-width:700px;'+
     'border:2px solid #487caa;border-radius:10px;background:#f2f7fc;color:#173553;';
   const title=root.document.createElement('h2');
   title.textContent='TEST-only private photo verification';
   const info=root.document.createElement('p');
   info.textContent='Uses this dashboard login to read one existing TEST photo. '+
     'No tokens to copy; no photos, reviews, or delivery settings will be changed.';
   const button=root.document.createElement('button');
   button.type='button';button.className='secondary';
   button.textContent='Verify TEST photo bytes';
   const output=root.document.createElement('p');
   output.setAttribute('role','status');output.setAttribute('aria-live','polite');
   output.textContent='Not started.';
   panel.append(title,info,button,output);
   host.prepend(panel);
   button.addEventListener('click',async()=>{
     button.disabled=true;output.textContent='Checking existing TEST photo…';
     try{
       // The binding is established by the existing app/session scripts.
       const token=typeof accessToken!=='undefined'?accessToken:null;
       const result=await verifyBrowserPrivatePhoto({
         fetcher:root.fetch.bind(root),adminToken:token,
         hashBytes:async bytes=>{
           const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
           return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
         },status:message=>{output.textContent=message;}
       });
       output.textContent=(result.verified?'PASS:':'PARTIAL:')+
         ' Existing TEST photo: '+result.bytes+' bytes across '+result.ranges+
         ' HTTP 206 ranges; SHA-256 matches. Content-Range header: '+
         (result.content_range==='VERIFIED'?'VERIFIED':'NOT EXPOSED (pending independent check)')+
         '. Anonymous Storage: '+
         (result.anonymous_storage==='DENIED'?'DENIED':
           'REJECTED 400 (authorization denial not proved)')+
         '; anonymous signer: '+
         (result.anonymous_signer==='DENIED'?'DENIED':
           'REJECTED 400 (authorization denial not proved)')+
         '. Foreign-user check remains pending. No photo or Send changed.';
     }catch(e){
       const allow=new Set(['SIGN_IN_TO_TEST_DASHBOARD','TEST_RUNTIME_UNAVAILABLE',
         'TEST_WORK_ORDER_UNAVAILABLE','TEST_PHOTO_NOT_AVAILABLE','NETWORK_UNAVAILABLE',
         'AUTHORIZED_READ_DENIED','UNTRUSTED_RESPONSE','INVALID_SIGNED_URL',
         'RANGE_206_UNSUPPORTED','RANGE_IDENTITY_MISMATCH','RANGE_BYTE_MISMATCH',
         'SHA256_RECEIPT_MISMATCH','SIGNED_HEAD_NOT_AVAILABLE',
         'SIGNED_HEAD_IDENTITY_UNVERIFIED','ANONYMOUS_STORAGE_ACCESS_EXPOSED',
         'ANONYMOUS_SIGNER_ACCESS_EXPOSED',
         'ANONYMOUS_STORAGE_ACCESS_STATUS_UNVERIFIED',
         'ANONYMOUS_SIGNER_ACCESS_STATUS_UNVERIFIED']);
       output.textContent='BLOCKED: '+(allow.has(e.code)?e.code:'PRIVATE_TEST_UNVERIFIED')+
         '. No photo or delivery change.';
     }finally{button.disabled=false;}
   });
 };
 if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',ready);
 else ready();
}
})(typeof window!=='undefined'?window:null);
