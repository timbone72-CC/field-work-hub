// Trusted Supabase service-JWT RPC adapter. Never instantiate in browser or
// on Contractor Android. Only the enumerated service-role RPCs are accessible.
import {DriveUncertain} from './drive-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const METHODS=new Set(['service_claim_delivery','service_heartbeat_delivery',
 'service_reserve_delivery_file','service_read_upload_session',
 'service_store_upload_session','service_record_upload_offset',
 'service_get_delivery_file_plan',
 'service_confirm_delivery_file','service_finish_delivery',
 'service_quarantine_expired_delivery']);
export function createServiceLedger({url,serviceRoleJwt,fetcher=fetch}={}){
  let origin;
  try{origin=new URL(url);}catch{throw new DriveUncertain('SERVICE_BACKEND_NOT_CONFIGURED');}
  if(origin.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)
    ||origin.username||origin.password||origin.port||origin.search||origin.hash
    ||(origin.pathname!==''&&origin.pathname!=='/')
    ||typeof serviceRoleJwt!=='string'||!/^[-_a-zA-Z0-9]{5,}\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(serviceRoleJwt))
    throw new DriveUncertain('SERVICE_BACKEND_NOT_CONFIGURED');
  const rpc=async(method,body)=>{
    if(!METHODS.has(method))throw new DriveUncertain('SERVICE_RPC_DENIED');
    let response;
    try{
      response=await fetcher(new URL('/rest/v1/rpc/'+method,origin).toString(),{
        method:'POST',redirect:'error',headers:{
          'Content-Type':'application/json','apikey':serviceRoleJwt,
          'Authorization':'Bearer '+serviceRoleJwt},body:JSON.stringify(body)
      });
    }catch{throw new DriveUncertain('SERVICE_RPC_OUTCOME_UNCERTAIN');}
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      throw new DriveUncertain(response.status===401||response.status===403
        ? 'SERVICE_RPC_AUTH_DENIED':'SERVICE_RPC_UNAVAILABLE');
    }
    let raw;
    try{raw=await response.text();if(raw.length>250000)throw Error();return JSON.parse(raw);}
    catch{throw new DriveUncertain('SERVICE_RPC_RESPONSE_INVALID');}
  };
  return {
    claim:worker=>rpc('service_claim_delivery',{p_worker:worker}),
    heartbeat:(pkg,worker,gen)=>rpc('service_heartbeat_delivery',
      {p_package:pkg,p_worker:worker,p_generation:gen}),
    reserve:(pkg,worker,gen,kind,photo,id,parent)=>rpc('service_reserve_delivery_file',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_kind:kind,
        p_photo:photo,p_file_id:id,p_parent_id:parent}),
    forLease:(pkg,worker,gen)=>({
      heartbeat:(p,w,g)=>rpc('service_heartbeat_delivery',
        {p_package:p,p_worker:w,p_generation:g}),
      getFilePlan:plan=>rpc('service_get_delivery_file_plan',
        {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan}),
      getSession:async plan=>{
        const result=await rpc('service_read_upload_session',
          {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan});
        return result.exists===false?null:result;
      },
      storeSession:(p,w,g,plan,encrypted)=>rpc('service_store_upload_session',
        {p_package:p,p_worker:w,p_generation:g,p_plan:plan,p_sealed:encrypted}),
      recordOffset:(p,w,g,plan,offset,complete)=>rpc('service_record_upload_offset',
        {p_package:p,p_worker:w,p_generation:g,p_plan:plan,
          p_offset:offset,p_complete_candidate:complete}),
      confirmFile:(plan,w,g,verified)=>rpc('service_confirm_delivery_file',{
        p_package:plan.package_id,p_worker:w,p_generation:g,
        p_kind:plan.kind,p_photo:plan.photo_id??null,
        p_file_id:verified.id,p_parent:verified.parent,p_mime:plan.mime,
        p_sha256:verified.sha256,p_size:verified.size
      })
    }),
    finish:(pkg,worker,gen)=>rpc('service_finish_delivery',
      {p_package:pkg,p_worker:worker,p_generation:gen}),
    quarantine:pkg=>rpc('service_quarantine_expired_delivery',{p_package:pkg})
  };
}
