// Fenced, service-only source bytes for the EXISTING delivery worker.
// Never accept object URLs/paths from a browser, Android, or a Drive response.
// This module alone cannot release packages or authorize phone cleanup.
import {DriveUncertain} from './drive-client.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const STEP=256*1024;
const MAX=32*1024*1024;
function unavailable(){throw new DriveUncertain('PROTECTED_SOURCE_CHUNK_UNAVAILABLE');}
function exactPlan(requested,current){
  if(!current||!requested||!UUID.test(current.package_id??'')
    ||!UUID.test(current.plan_id??'')||current.package_id!==requested.package_id
    ||current.plan_id!==requested.plan_id||current.kind!==requested.kind
    ||current.file_id!==requested.file_id||current.parent_id!==requested.parent_id
    ||current.name!==requested.name||current.mime!==requested.mime
    ||current.sha256!==requested.sha256||current.size!==requested.size
    ||!SHA.test(current.sha256??'')||!Number.isSafeInteger(current.size)
    ||current.size<1||current.size>MAX)unavailable();
  if(!current.appProperties
    ||current.appProperties.fwh_package!==current.package_id
    ||current.appProperties.fwh_manifest!==requested.appProperties?.fwh_manifest)unavailable();
}
function exactPhotoSource(plan){
  const source=plan.source;
  if(plan.kind!=='PHOTO'||plan.mime!=='image/jpeg'
    ||!UUID.test(plan.photo_id??'')||source?.bucket!=='fwh-review-private'
    ||source.photo_id!==plan.photo_id||!UUID.test(source.owner_id??'')
    ||!UUID.test(source.object_id??'')||!UUID.test(source.transfer_version??'')
    ||typeof source.object_version!=='string'||source.object_version.length<1
    ||source.object_version.length>256||typeof source.object_key!=='string')unavailable();
  const p=source.object_key.split('/');
  if(p.length!==4||!p.slice(0,3).every(x=>UUID.test(x))
    ||p[3]!==plan.photo_id+'.jpg')unavailable();
  return p.map(encodeURIComponent).join('/');
}
async function bounded(response,expected){
  if(!response.body)unavailable();
  const reader=response.body.getReader(),output=new Uint8Array(expected);
  let read=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      if(!(next.value instanceof Uint8Array)
        ||read+next.value.length>expected)unavailable();
      output.set(next.value,read);read+=next.value.length;
    }
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  if(read!==expected)unavailable();
  return output;
}

/**
 * Instantiate only inside the trusted delivery runtime with an active
 * lease-bound service ledger (ledger.forLease). Every chunk re-fetches the
 * exact frozen source projection, so a revoked lease denies the next read.
 */
export function createPrivateSourceChunkReader({
  projectUrl,serviceRoleJwt,ledger,fetcher=fetch
}={}){
  let origin;
  try{origin=new URL(projectUrl);}catch{unavailable();}
  if(origin.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)
    ||origin.username||origin.password||origin.port||origin.search||origin.hash
    ||(origin.pathname!==''&&origin.pathname!=='/')
    ||typeof serviceRoleJwt!=='string'
    ||!/^[-_a-zA-Z0-9]{5,}\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(serviceRoleJwt)
    ||typeof ledger?.getFilePlan!=='function'
    ||typeof fetcher!=='function')unavailable();
  return async function readProtectedChunk(plan,offset,count){
    if(!Number.isSafeInteger(offset)||offset<0
      ||!Number.isSafeInteger(count)||count<1||count>STEP
      ||!Number.isSafeInteger(plan?.size)||offset+count>plan.size
      ||!UUID.test(plan?.plan_id??''))unavailable();
    let current;
    try{current=await ledger.getFilePlan(plan.plan_id);}
    catch{unavailable();}
    exactPlan(plan,current);
    if(current.kind==='MANIFEST'){
      if(current.photo_id!==null||current.mime!=='application/json'
        ||typeof current.source?.manifest_bytes!=='string')unavailable();
      const bytes=new TextEncoder().encode(current.source.manifest_bytes);
      if(bytes.length!==current.size)unavailable();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
        b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!==current.sha256)unavailable();
      return bytes.slice(offset,offset+count);
    }
    const key=exactPhotoSource(current);
    const target=new URL('/storage/v1/object/authenticated/fwh-review-private/'+key,origin);
    let response;
    try{
      response=await fetcher(target.toString(),{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),
        headers:{
          apikey:serviceRoleJwt,Authorization:'Bearer '+serviceRoleJwt,
          Range:'bytes='+offset+'-'+(offset+count-1),
          'Accept-Encoding':'identity'
        }
      });
      if(response.status!==206
        ||(response.headers.get('Content-Type')||'').split(';')[0].trim()!=='image/jpeg'
        ||!['', 'identity'].includes(response.headers.get('Content-Encoding')||''))unavailable();
      const range=response.headers.get('Content-Range')||'';
      const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if(!match||Number(match[1])!==offset
        ||Number(match[2])!==offset+count-1
        ||Number(match[3])!==current.size)unavailable();
      const length=response.headers.get('Content-Length');
      if(length!==null&&length!==String(count))unavailable();
      return await bounded(response,count);
    }catch{
      unavailable();
    }finally{
      await response?.body?.cancel().catch(()=>{});
    }
  };
}
