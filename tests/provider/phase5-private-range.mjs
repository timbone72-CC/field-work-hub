// Explicit real-provider gate for a PREEXISTING disposable FWH review photo.
// Reads only. No upload, migration, bucket provisioning, service role, Send,
// cleanup, or mutation. Do not run against customer evidence.
// Node 22+; keep private credentials in environment, never in git or logs.
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
 'ANONYMOUS_ACCESS_EXPOSED','FOREIGN_OWNER_ACCESS_EXPOSED','REMOTE_READ_FAILED',
 'REMOTE_PARTIAL_RANGE_REQUIRED','REMOTE_RANGE_IDENTITY_MISMATCH',
 'REMOTE_BYTE_LENGTH_MISMATCH','REMOTE_CONTENT_CHANGED']);

function stop(code){
  const e=new Error(code);e.code=code;throw e;
}
function jwtPayload(jwt) {
  try{
    const [header,body,sig]=jwt.split('.');
    if(!header||!body||!sig)return null;
    return JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  }catch{return null;}
}
function exactSpec(s) {
  if(s?.fixtureType!=='DISPOSABLE_FWH_TEST_ONLY'||s?.projectUrl!==HOST
    ||s.bucket!==BUCKET||!UUID.test(s.ownerId??'')
    ||!HASH.test(s.sha256??'')||!Number.isSafeInteger(s.size)
    ||s.size<1||s.size>MAX||typeof s.objectKey!=='string')stop('INVALID_TEST_CONFIGURATION');
  const key=s.objectKey.split('/');
  if(key.length!==4||!key.slice(0,3).every(x=>UUID.test(x))
    ||!UUID.test(key[3].slice(0,-4))||key[3]!==s.photoId+'.jpg'
    ||!UUID.test(s.photoId??''))stop('INVALID_TEST_CONFIGURATION');
  // A test Owner must be authenticated to its own registered organization
  // and exact current session. JWT here is an input sanity gate ONLY:
  // Supabase alone validates its signature, session and RLS at HTTP.
  if(typeof s.publishableKey!=='string'||s.publishableKey.length<10
    ||typeof s.ownerJwt!=='string'||s.ownerJwt.length<20)stop('INVALID_TEST_CONFIGURATION');
  const owner=jwtPayload(s.ownerJwt);
  if(owner?.role!=='authenticated'||owner?.sub?.toLowerCase()!==s.ownerId.toLowerCase()
    ||!UUID.test(owner.session_id??'')
    ||owner?.app_metadata?.organization_id?.toLowerCase()!==key[0].toLowerCase()
    ||owner.is_anonymous===true||owner?.is_anonymous===true)
    stop('INVALID_TEST_CONFIGURATION');
  if(s.otherOwnerJwt!==undefined){
    const stranger=jwtPayload(s.otherOwnerJwt);
    if(!stranger||stranger.role!=='authenticated'
      ||!UUID.test(stranger.sub??'')||stranger.sub.toLowerCase()===s.ownerId.toLowerCase()
      ||!UUID.test(stranger.session_id??''))stop('INVALID_TEST_CONFIGURATION');
  }
  return key.map(encodeURIComponent).join('/');
}
async function get(fetcher,url,apikey,jwt,start,end){
  const headers={apikey,Range:`bytes=${start}-${end}`,Accept:'image/jpeg','Accept-Encoding':'identity'};
  if(jwt)headers.Authorization='Bearer '+jwt;
  try{return await fetcher(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});}
  catch{stop('REMOTE_READ_FAILED');}
}
async function boundedResponse(res,need,from,to,total){
  if(res.status!==206)stop('REMOTE_PARTIAL_RANGE_REQUIRED');
  const m=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range')||'');
  if(!m||Number(m[1])!==from||Number(m[2])!==to||Number(m[3])!==total)
    stop('REMOTE_RANGE_IDENTITY_MISMATCH');
  const mime=(res.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(mime!=='image/jpeg'||!['','identity'].includes(res.headers.get('Content-Encoding')||'')
    ||(res.headers.has('Content-Length')&&res.headers.get('Content-Length')!==String(need)))
    stop('REMOTE_RANGE_IDENTITY_MISMATCH');
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
  }catch(e){if(allowed.has(e.code))throw e;stop('REMOTE_READ_FAILED');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(count!==need)stop('REMOTE_BYTE_LENGTH_MISMATCH');
  return output;
}
export async function verifyExistingDisposablePrivatePhoto(spec,{fetcher=fetch}={}){
  if(typeof fetcher!=='function')stop('INVALID_TEST_CONFIGURATION');
  const key=exactSpec(spec);
  const url=HOST+'/storage/v1/object/authenticated/'+BUCKET+'/'+key;
  const anon=await get(fetcher,url,spec.publishableKey,null,0,0);
  try{if(!DENIED.has(anon.status))stop('ANONYMOUS_ACCESS_EXPOSED');}
  finally{await anon.body?.cancel().catch(()=>{});}
  let foreignRole='NOT_SUPPLIED';
  if(spec.otherOwnerJwt){
    const foreign=await get(fetcher,url,spec.publishableKey,spec.otherOwnerJwt,0,0);
    try{if(!DENIED.has(foreign.status))stop('FOREIGN_OWNER_ACCESS_EXPOSED');}
    finally{await foreign.body?.cancel().catch(()=>{});}
    foreignRole='DENIED';
  }
  const sha=createHash('sha256');
  let chunks=0;
  for(let at=0;at<spec.size;at+=CHUNK){
    const end=Math.min(at+CHUNK,spec.size)-1;
    const res=await get(fetcher,url,spec.publishableKey,spec.ownerJwt,at,end);
    const content=await boundedResponse(res,end-at+1,at,end,spec.size);
    sha.update(content);chunks++;
  }
  if(sha.digest('hex')!==spec.sha256)stop('REMOTE_CONTENT_CHANGED');
  // No object ID, filename, link, JWT, tokens or byte content in output.
  return Object.freeze({gate:'REAL_EXISTING_DISPOSABLE_PHOTO_RANGE',
    verified:true,anonymous:'DENIED',other_owner:foreignRole,
    bytes:spec.size,chunks,remote_hash_verified:true});
}
function fromEnvironment(env){
  return {fixtureType:env.FWH_TEST_EVIDENCE_CLASS,
    projectUrl:env.FWH_TEST_PROJECT_URL,bucket:env.FWH_TEST_BUCKET,
    objectKey:env.FWH_TEST_OBJECT_KEY,photoId:env.FWH_TEST_PHOTO_ID,
    ownerId:env.FWH_TEST_OWNER_ID,sha256:env.FWH_TEST_SHA256,
    size:Number(env.FWH_TEST_SIZE),publishableKey:env.FWH_TEST_PUBLISHABLE_KEY,
    ownerJwt:env.FWH_TEST_OWNER_JWT,
    ...(env.FWH_TEST_OTHER_OWNER_JWT?{otherOwnerJwt:env.FWH_TEST_OTHER_OWNER_JWT}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  verifyExistingDisposablePrivatePhoto(fromEnvironment(process.env))
    .then(data=>{process.stdout.write(JSON.stringify(data)+'\n');})
    .catch(e=>{
      // Treat every unexpected failure as a single fixed non-sensitive result.
      const code=allowed.has(e?.code)?e.code:'REMOTE_READ_FAILED';
      process.stderr.write('FWH_PRIVATE_GATE_FAILED '+code+'\n');
      process.exitCode=1;
    });
}
