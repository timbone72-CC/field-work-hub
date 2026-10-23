// Trusted Supabase service-JWT RPC adapter. Never instantiate in browser or
// on Contractor Android. Only the enumerated service-role RPCs are accessible.
import {DriveUncertain} from './drive-client.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const METHODS=new Set(['service_acquire_delivery_dispatch','service_release_delivery_dispatch',
 'service_read_active_delivery_lease','service_next_delivery_item',
 'service_delivery_final_provider_snapshot','service_claim_delivery',
 'service_claim_exact_test_delivery','service_heartbeat_delivery',
 'service_reserve_delivery_file_set','service_read_delivery_parent',
 'service_reserve_delivery_parent','service_read_geographic_parent',
 'service_reserve_geographic_parent','service_read_geographic_leaf',
 'service_reserve_geographic_leaf','service_begin_delivery_parent_create',
 'service_confirm_delivery_parent','service_get_delivery_folder_plan',
 'service_begin_delivery_folder_create','service_confirm_delivery_folder',
 'service_read_upload_session','service_begin_upload_session',
 'service_store_upload_session','service_record_upload_offset',
 'service_get_delivery_file_plan',
 'service_confirm_delivery_file','service_finish_delivery',
 'service_quarantine_expired_delivery',
 'service_read_client_destination_candidate',
 'service_record_client_destination_preflight',
 'service_read_client_destination_provider_proof',
 'service_reserve_client_destination_provider_proof',
 'service_confirm_client_destination_provider_proof']);
// Privileged backend-only formats. Supabase secret API keys are NOT JWTs.
export function serviceCredentialHeaders(serviceRoleJwt){
  const legacy=typeof serviceRoleJwt==='string'
    &&/^[-_a-zA-Z0-9]{5,}\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(serviceRoleJwt);
  const secret=typeof serviceRoleJwt==='string'
    &&/^sb_secret_[a-zA-Z0-9_-]{16,}$/.test(serviceRoleJwt);
  if(!legacy&&!secret)
    throw new DriveUncertain('SERVICE_BACKEND_KEY_FORMAT_INVALID');
  return legacy
    ?{apikey:serviceRoleJwt,Authorization:'Bearer '+serviceRoleJwt}
    :{apikey:serviceRoleJwt};
}
export function createServiceLedger({url,serviceRoleJwt,fetcher=fetch}={}){
  let origin;
  try{origin=new URL(url);}catch{throw new DriveUncertain('SERVICE_BACKEND_URL_INVALID');}
  if(origin.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)
    ||origin.username||origin.password||origin.port||origin.search||origin.hash
    ||(origin.pathname!==''&&origin.pathname!=='/'))
    throw new DriveUncertain('SERVICE_BACKEND_URL_INVALID');
  const authorization=serviceCredentialHeaders(serviceRoleJwt);
  const rpc=async(method,body)=>{
    if(!METHODS.has(method))throw new DriveUncertain('SERVICE_RPC_DENIED');
    let response;
    try{
      response=await fetcher(new URL('/rest/v1/rpc/'+method,origin).toString(),{
        method:'POST',redirect:'error',headers:{
          'Content-Type':'application/json',...authorization},body:JSON.stringify(body)
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
    // Service-only read of the exact inactive Admin proposal precedes any
    // Google GET. The service never trusts client-origin company/root labels.
    readClientDestination:id=>rpc('service_read_client_destination_candidate',
      {p_destination:id}),
    recordClientDestinationPreflight:(action,candidate,driveId)=>
      rpc('service_record_client_destination_preflight',{
        p_action:action,p_destination:candidate.destination_id,
        p_expected_revision:candidate.revision,
        p_provider_identity:candidate.provider_identity,
        p_root:candidate.root_folder_id,p_shared_drive:driveId
      }),
    readClientDestinationProviderProof:id=>rpc(
      'service_read_client_destination_provider_proof',{p_destination:id}),
    reserveClientDestinationProviderProof:(action,preflight,candidate,fileId,driveId)=>
      rpc('service_reserve_client_destination_provider_proof',{
        p_destination:candidate.destination_id,p_action:action,
        p_preflight:preflight,p_revision:candidate.revision,
        p_file_id:fileId,p_drive_id:driveId
      }),
    confirmClientDestinationProviderProof:(action,preflight,candidate,fileId,driveId)=>
      rpc('service_confirm_client_destination_provider_proof',{
        p_destination:candidate.destination_id,p_action:action,
        p_preflight:preflight,p_revision:candidate.revision,
        p_file_id:fileId,p_drive_id:driveId
      }),
    // The only dispatch permit. It spans all provider network awaits across
    // hosted processes; a crashed/ambiguous invocation stays blocked.
    acquireDispatch:request=>rpc('service_acquire_delivery_dispatch',
      {p_request:request}),
    releaseDispatch:request=>rpc('service_release_delivery_dispatch',
      {p_request:request}),
    // Read-only ORIGINAL unexpired lease from durable outbox; never reclaim.
    readActiveLease:()=>rpc('service_read_active_delivery_lease',{}),
    nextReservedItem:(pkg,worker,gen)=>rpc('service_next_delivery_item',
      {p_package:pkg,p_worker:worker,p_generation:gen}),
    finalProviderSnapshot:(pkg,worker,gen)=>rpc(
      'service_delivery_final_provider_snapshot',
      {p_package:pkg,p_worker:worker,p_generation:gen}),
    claim:worker=>rpc('service_claim_delivery',{p_worker:worker}),
    // FWH TEST-only scoped claim MUST be a single backend transaction.
    // Missing RPC or uncertain result never falls back to broad claim.
    claimExactTest:(worker,pkg,destination,root)=>rpc(
      'service_claim_exact_test_delivery',{
        p_worker:worker,p_package:pkg,p_destination:destination,p_root:root
      }),
    heartbeat:(pkg,worker,gen)=>rpc('service_heartbeat_delivery',
      {p_package:pkg,p_worker:worker,p_generation:gen}),
    reserveBatch:(pkg,worker,gen,folder,parent,photos,manifest)=>rpc(
      'service_reserve_delivery_file_set',{
        p_package:pkg,p_worker:worker,p_generation:gen,
        p_folder_id:folder,p_parent_id:parent,
        p_photos:photos,p_manifest_id:manifest}),
    // Exact company/destination mapping lookup precedes generateIds. The
    // server freezes both original IDs and authoritative parent IDs.
    readParent:(pkg,worker,gen,kind)=>rpc(
      ['STATE','COUNTY','CITY'].includes(kind)?'service_read_geographic_parent':'service_read_delivery_parent',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_kind:kind}),
    reserveParent:(pkg,worker,gen,kind,id,parent)=>rpc(
      ['STATE','COUNTY','CITY'].includes(kind)?'service_reserve_geographic_parent':'service_reserve_delivery_parent',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_kind:kind,
        p_remote_id:id,p_parent_id:parent}),
    // Explicit geographic leaf methods never fall back to legacy root/ADDRESS.
    readGeographicLeaf:(pkg,worker,gen,kind)=>rpc('service_read_geographic_leaf',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_kind:kind}),
    reserveGeographicLeaf:(pkg,worker,gen,kind,id,parent)=>rpc('service_reserve_geographic_leaf',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_kind:kind,
        p_remote_id:id,p_parent_id:parent}),
    beginParentCreate:(pkg,worker,gen,map)=>rpc('service_begin_delivery_parent_create',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_map:map}),
    confirmParent:(pkg,worker,gen,map,proof)=>rpc('service_confirm_delivery_parent',
      {p_package:pkg,p_worker:worker,p_generation:gen,p_map:map,p_proof:proof}),
    forLease:(pkg,worker,gen)=>({
      heartbeat:(p,w,g)=>rpc('service_heartbeat_delivery',
        {p_package:p,p_worker:w,p_generation:g}),
      getFilePlan:plan=>rpc('service_get_delivery_file_plan',
        {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan}),
      getFolderPlan:plan=>rpc('service_get_delivery_folder_plan',
        {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan}),
      beginFolderCreate:plan=>rpc('service_begin_delivery_folder_create',
        {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan}),
      confirmFolder:(folder,w,g,proof)=>rpc('service_confirm_delivery_folder',{
        p_package:folder.package_id,p_worker:w,p_generation:g,
        p_plan:folder.plan_id,p_proof:proof
      }),
      getSession:async plan=>{
        const result=await rpc('service_read_upload_session',
          {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan});
        return result.exists===false?null:result;
      },
      beginSession:plan=>rpc('service_begin_upload_session',
        {p_package:pkg,p_worker:worker,p_generation:gen,p_plan:plan}),
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
