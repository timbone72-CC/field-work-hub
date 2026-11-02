// Read-only real-provider gate for an ALREADY RECEIVED disposable FWH photo.
// The upload-only Storage RLS policy intentionally denies owner reads after receipt.
// Verified photos are read through the existing scoped Admin Edge signer and a
// short-lived Storage signed URL. No SQL, storage writes, Send or cleanup.
// Node 22+. JWTs and signed URLs stay in a private process environment.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const HOST='https://vyocaujuwrivoqynvitm.supabase.co';
const BUCKET='fwh-review-private';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const CHUNK=256*1024;
const MAX=32*1024*1024;
const DENIED=new Set([401,403,404]);
const allowed=new Set(['INVALID_TEST_CONFIGURATION','PRIVATE_READ_UNAUTHORIZED',
  'ANONYMOUS_ACCESS_EXPOSED','FOREIGN_OFFICE_ACCESS_EXPOSED',
  'RECEIVED_OWNER_DIRECT_ACCESS_EXPOSED','REMOTE_READ_FAILED',
  'PRIVATE_SIGNED_URL_INVALID','PRIVATE_SIGNED_URL_UNAVAILABLE',
  'REMOTE_PARTIAL_RANGE_REQUIRED','REMOTE_RANGE_IDENTITY_MISMATCH',
  'REMOTE_BYTE_LENGTH_MISMATCH','REMOTE_CONTENT_CHANGED']);
function stop(code){const e=new Error(code);e.code=code;throw e;}
function jwtPayload(jwt){
  try{
    const [header,body,sig]=jwt.split('.');
    if(!header||!body||!sig)return null;
    return JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  }catch{return null;}
}
function exactSpec(s){
  if(s?.fixtureType!=='DISPOSABLE_FWH_TEST_ONLY'||s.projectUrl!==HOST
    ||s.bucket!==BUCKET||!UUID.test(s.ownerId??'')
    ||!UUID.test(s.photoId??'')||!UUID.test(s.transferVersion??'')
    ||!HASH.test(s.sha256??'')||!Number.isSafeInteger(s.size)
    ||s.size<1||s.size>MAX||typeof s.objectKey!=='string'
    ||typeof s.publishableKey!=='string'||s.publishableKey.length<10
    ||typeof s.adminJwt!=='string'||s.adminJwt.length<20)
    stop('INVALID_TEST_CONFIGURATION');
  const parts=s.objectKey.split('/');
  if(parts.length!==4||!parts.slice(0,3).every(x=>UUID.test(x))
    ||parts[3]!==s.photoId+'.jpg')stop('INVALID_TEST_CONFIGURATION');
  const office=jwtPayload(s.adminJwt);
  if(office?.role!=='authenticated'||!UUID.test(office.sub??'')
    ||!UUID.test(office.session_id??'')||office.is_anonymous===true
    ||office.app_metadata?.organization_id?.toLowerCase()!==parts[0].toLowerCase())
    stop('INVALID_TEST_CONFIGURATION');
  // These are input checks, not an authorization claim: Auth and the private
  // server-side target RPC validate JWT signature, scope and current session.
  if(s.ownerJwt!==undefined){
    const owner=jwtPayload(s.ownerJwt);
    if(owner?.role!=='authenticated'||owner.sub?.toLowerCase()!==s.ownerId.toLowerCase()
      ||!UUID.test(owner.session_id??''))stop('INVALID_TEST_CONFIGURATION');
  }
  if(s.otherUserJwt!==undefined){
    const other=jwtPayload(s.otherUserJwt);
    if(other?.role!=='authenticated'||!UUID.test(other.sub??'')
      ||!UUID.test(other.session_id??'')
      ||other.sub.toLowerCase()===office.sub.toLowerCase())
      stop('INVALID_TEST_CONFIGURATION');
  }
  return parts.map(encodeURIComponent).join('/');
}
async function call(fetcher,url,options){
  try{return await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{stop('REMOTE_READ_FAILED');}
}
async function dispose(response){await response?.body?.cancel().catch(()=>{});}
async function signedResponse(response,spec,encodedPath){
  if(response.status!==200){await dispose(response);stop('PRIVATE_READ_UNAUTHORIZED');}
  let body;
  try{
    if(!(response.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
      stop('PRIVATE_SIGNED_URL_INVALID');
    const text=await response.text();
    if(text.length>4096)stop('PRIVATE_SIGNED_URL_INVALID');
    body=JSON.parse(text);
  }catch(e){if(allowed.has(e?.code))throw e;stop('PRIVATE_SIGNED_URL_INVALID');}
  if(body?.photo_id!==spec.photoId||body?.transfer_version!==spec.transferVersion
    ||!Number.isInteger(body.expires_in)||body.expires_in<1||body.expires_in>120
    ||typeof body.url!=='string'||body.url.length>3500)
    stop('PRIVATE_SIGNED_URL_INVALID');
  let url;
  try{url=new URL(body.url);}catch{stop('PRIVATE_SIGNED_URL_INVALID');}
  if(url.origin!==HOST||url.username||url.password||url.hash
    ||url.pathname!=='/storage/v1/object/sign/'+BUCKET+'/'+encodedPath
    ||url.searchParams.size!==1||!url.searchParams.get('token'))
    stop('PRIVATE_SIGNED_URL_INVALID');
  return url.toString();
}
async function boundedResponse(res,need,from,to,total){
  if(res.status!==206){await dispose(res);stop('REMOTE_PARTIAL_RANGE_REQUIRED');}
  const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range')||'');
  if(!m||Number(m[1])!==from||Number(m[2])!==to||Number(m[3])!==total){
    await dispose(res);stop('REMOTE_RANGE_IDENTITY_MISMATCH');
  }
  const mime=(res.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(mime!=='image/jpeg'||!['','identity'].includes(res.headers.get('Content-Encoding')||'')
    ||(res.headers.has('Content-Length')&&res.headers.get('Content-Length')!==String(need))){
    await dispose(res);stop('REMOTE_RANGE_IDENTITY_MISMATCH');
  }
  if(!res.body)stop('REMOTE_BYTE_LENGTH_MISMATCH');
  const reader=res.body.getReader();let count=0;
  const output=new Uint8Array(need);
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array)||count+value.length>need)
        stop('REMOTE_BYTE_LENGTH_MISMATCH');
      output.set(value,count);count+=value.length;
    }
  }catch(e){if(allowed.has(e?.code))throw e;stop('REMOTE_READ_FAILED');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(count!==need)stop('REMOTE_BYTE_LENGTH_MISMATCH');
  return output;
}
export async function verifyExistingDisposablePrivatePhoto(spec,{fetcher=fetch}={}){
  if(typeof fetcher!=='function')stop('INVALID_TEST_CONFIGURATION');
  const key=exactSpec(spec);
  const direct=HOST+'/storage/v1/object/authenticated/'+BUCKET+'/'+key;
  const edge=HOST+'/functions/v1/admin-private-photo';
  const plainHeaders={apikey:spec.publishableKey,Accept:'image/jpeg',Range:'bytes=0-0'};
  // Raw reads of RECEIVED evidence must stay forbidden to anonymous callers.
  const anonymous=await call(fetcher,direct,{method:'GET',headers:plainHeaders});
  try{if(!DENIED.has(anonymous.status))stop('ANONYMOUS_ACCESS_EXPOSED');}
  finally{await dispose(anonymous);}
  let ownerDirect='NOT_SUPPLIED';
  if(spec.ownerJwt){
    const owner=await call(fetcher,direct,{method:'GET',headers:{
      ...plainHeaders,Authorization:'Bearer '+spec.ownerJwt}});
    try{if(!DENIED.has(owner.status))stop('RECEIVED_OWNER_DIRECT_ACCESS_EXPOSED');}
    finally{await dispose(owner);}
    ownerDirect='DENIED';
  }
  const payload=JSON.stringify({photo_id:spec.photoId,transfer_version:spec.transferVersion});
  const officeHeaders={apikey:spec.publishableKey,'Content-Type':'application/json'};
  // The actual server-mediated Admin signer must deny missing and unauthorized
  // sessions; no signed URL is constructed or guessed by this test.
  const noAuth=await call(fetcher,edge,{method:'POST',headers:officeHeaders,body:payload});
  try{if(!DENIED.has(noAuth.status))stop('ANONYMOUS_ACCESS_EXPOSED');}
  finally{await dispose(noAuth);}
  let otherOffice='NOT_SUPPLIED';
  if(spec.otherUserJwt){
    const other=await call(fetcher,edge,{method:'POST',headers:{
      ...officeHeaders,Authorization:'Bearer '+spec.otherUserJwt},body:payload});
    try{if(!DENIED.has(other.status))stop('FOREIGN_OFFICE_ACCESS_EXPOSED');}
    finally{await dispose(other);}
    otherOffice='DENIED';
  }
  const signed=await call(fetcher,edge,{method:'POST',headers:{
    ...officeHeaders,Authorization:'Bearer '+spec.adminJwt},body:payload});
  const signedUrl=await signedResponse(signed,spec,key);
  const sha=createHash('sha256');let chunks=0;
  for(let at=0;at<spec.size;at+=CHUNK){
    const end=Math.min(at+CHUNK,spec.size)-1;
    const res=await call(fetcher,signedUrl,{method:'GET',headers:{
      Range:'bytes='+at+'-'+end,Accept:'image/jpeg','Accept-Encoding':'identity'}});
    sha.update(await boundedResponse(res,end-at+1,at,end,spec.size));
    chunks++;
  }
  if(sha.digest('hex')!==spec.sha256)stop('REMOTE_CONTENT_CHANGED');
  return Object.freeze({gate:'REAL_RECEIVED_TEST_PHOTO_SIGNED_RANGE',
    verified:true,anonymous:'DENIED',owner_direct:ownerDirect,
    other_office:otherOffice,bytes:spec.size,chunks,remote_hash_verified:true});
}
function fromEnvironment(env){
  return {fixtureType:env.FWH_TEST_EVIDENCE_CLASS,
    projectUrl:env.FWH_TEST_PROJECT_URL,bucket:env.FWH_TEST_BUCKET,
    objectKey:env.FWH_TEST_OBJECT_KEY,photoId:env.FWH_TEST_PHOTO_ID,
    transferVersion:env.FWH_TEST_TRANSFER_VERSION,ownerId:env.FWH_TEST_OWNER_ID,
    sha256:env.FWH_TEST_SHA256,size:Number(env.FWH_TEST_SIZE),
    publishableKey:env.FWH_TEST_PUBLISHABLE_KEY,
    adminJwt:env.FWH_TEST_ADMIN_JWT,
    ...(env.FWH_TEST_OWNER_JWT?{ownerJwt:env.FWH_TEST_OWNER_JWT}:{}),
    ...(env.FWH_TEST_OTHER_USER_JWT?{otherUserJwt:env.FWH_TEST_OTHER_USER_JWT}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  verifyExistingDisposablePrivatePhoto(fromEnvironment(process.env))
    .then(data=>{process.stdout.write(JSON.stringify(data)+'\n');})
    .catch(e=>{
      const code=allowed.has(e?.code)?e.code:'REMOTE_READ_FAILED';
      process.stderr.write('FWH_PRIVATE_GATE_FAILED '+code+'\n');
      process.exitCode=1;
    });
}
