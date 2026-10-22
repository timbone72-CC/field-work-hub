// PRIVATE backend-only, default OFF. No browser CORS or client-triggered Send.
// When explicitly activated with the dedicated worker secret and a live fenced
// server lease, source-only continuation can make ONE guarded provider step.
// The hosted TEST function remains read-only; no scheduler or cleanup here.
import {createWorkspaceTokenProvider} from './workspace-oauth.mjs';
import {createDriveClient} from './drive-client.mjs';
import {createServiceLedger} from './service-ledger.mjs';
import {advanceTrustedDeliveryOneStep,prepareTrustedDelivery,continueTrustedDeliveryParent,
 continueTrustedGeographicLeaf,continueTrustedPackageFolder,
 continueTrustedDeliveryFile} from './worker-runtime.mjs';
import {createSessionVault} from './session-vault.mjs';
import {createReadOnlyTestHandler} from './test-preflight-only.mjs';

function reply(status,code) {
 return new Response(JSON.stringify({status:code}),{status,headers:{
  'Content-Type':'application/json','Cache-Control':'no-store, private'
 }});
}
// Compare fixed-length private worker key without early return on mismatch.
function sameSecret(x,y){
 if(typeof x!=='string'||typeof y!=='string'||!x||!y)return false;
 const a=new TextEncoder().encode(x),b=new TextEncoder().encode(y);
 let different=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)
  different|=(a[i]??0)^(b[i]??0);
 return different===0;
}
export function createDeliveryHandler({
  enabled=false,workerSecret,expectedAccount,expectedDriveId,
  testPreflightEnabled=false,testEvidenceClass,testRootFolderId,internalDriveId,
  testWorkspaceDomain,
  clientId,clientSecret,refreshToken,oauthScope,
  supabaseUrl,serviceRoleJwt,sessionVaultKey,
  fetcher=fetch,makeWorkerId=()=>crypto.randomUUID()
}={}){
 return async request=>{
  if(request.method!=='POST')return reply(405,'POST_ONLY');
  // No credential-less status, probe or public health route.
  if(!workerSecret||workerSecret.length<32
   ||!sameSecret(request.headers.get('x-fwh-delivery-secret'),workerSecret))
   return reply(401,'WORKER_UNAUTHORIZED');
  // Separate read-only TEST credential probe may run while Send is OFF.
  // No provider work is permitted when both capabilities are disabled.
  if(enabled===true&&testPreflightEnabled===true)
    return reply(503,'CONFLICTING_WORKER_MODES');
  // Preserve the EXACT hosted v11 read-only TEST gate on a future worker
  // rollout. No second OAuth/root-check implementation and no database RPC.
  // The existing adapter independently rejects preallocate, Send and every
  // mutating operation before touching Google or Supabase.
  if(enabled!==true&&testPreflightEnabled===true)
    return createReadOnlyTestHandler({
      deliveryActive:false,testEnabled:true,testEvidenceClass,workerSecret,
      expectedEmail:expectedAccount,expectedDriveId,
      clientRootId:testRootFolderId,internalDriveId,
      workspaceDomain:testWorkspaceDomain,clientId,clientSecret,
      refreshToken,oauthScope,sessionVaultKey,fetcher
    })(request);
  if(enabled!==true)
    return reply(503,'WORKER_NOT_ACTIVATED');
  let payload;
  try{
    if(request.headers.get('content-type')!=='application/json')
      return reply(400,'EXACT_REQUEST_REQUIRED');
    const body=await request.text();
    if(body.length>512)return reply(413,'REQUEST_TOO_LARGE');
    payload=JSON.parse(body);
  }catch{return reply(400,'EXACT_REQUEST_REQUIRED');}
  // Only a trusted backend caller holding the dedicated worker secret may
  // name an existing leased continuation. The service ledger rechecks the
  // exact frozen package/worker/generation before every remote operation.
  // One invocation performs at most ONE existing folder or file step.
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const fields={
    preallocate:['operation'],
    advance_once:['operation'],
    reconcile_parent:['operation','package_id','worker_id','generation','kind'],
    reconcile_geographic_leaf:['operation','package_id','worker_id','generation','kind'],
    reconcile_package_folder:['operation','package_id','worker_id','generation','plan_id'],
    transfer_one_chunk:['operation','package_id','worker_id','generation','plan_id']
  };
  const required=fields[payload?.operation];
  if(!payload||Array.isArray(payload)||!required
    ||Object.keys(payload).length!==required.length
    ||required.some(k=>!Object.hasOwn(payload,k)))
    return reply(400,'EXACT_REQUEST_REQUIRED');
  if(!['preallocate','advance_once'].includes(payload.operation)){
    if(!UUID.test(payload.package_id??'')||!UUID.test(payload.worker_id??'')
      ||!Number.isSafeInteger(payload.generation)||payload.generation<1
      ||(payload.plan_id!==undefined&&!UUID.test(payload.plan_id))
      ||(payload.operation==='reconcile_parent'
        &&!['STATE','COUNTY','CITY'].includes(payload.kind))
      ||(payload.operation==='reconcile_geographic_leaf'
        &&!['ADDRESS','WORK_ORDER'].includes(payload.kind)))
      return reply(400,'EXACT_REQUEST_REQUIRED');
  }
  if(!expectedAccount||!expectedDriveId||!oauthScope||!supabaseUrl
     ||!serviceRoleJwt||!clientId||!clientSecret||!refreshToken)
    return reply(503,'BACKEND_NOT_CONFIGURED');
  // Validate the original OAuth adapter before the durable dispatch permit.
  // Bad local client credentials/scope cannot perform a provider write and
  // must not leave the non-expiring single-flight permit held. Constructing
  // the adapter refreshes NO token and performs NO network request.
  let tokenProvider;
  try {
    tokenProvider=createWorkspaceTokenProvider({
      clientId,clientSecret,refreshToken,requiredScope:oauthScope,fetcher});
  } catch {return reply(503,'BACKEND_OAUTH_NOT_CONFIGURED');}
  // The original SQL lease protects each transaction, not simultaneous
  // Edge processes while their Google HTTP operations are in flight. Every
  // mutating worker route shares ONE persisted dispatch permit, across all
  // Supabase Edge instances. Read-only TEST mode never takes the permit.
  // Check the current encrypted-session key BEFORE the durable permit is
  // acquired. advance_once may select a file step even if the caller supplies
  // no plan identity; an absent/malformed key must not strand the singleton.
  // This does not decrypt prior sessions or authorize replacement keys/IDs.
  let vault;
  if(payload.operation==='advance_once'||payload.operation==='transfer_one_chunk'){
    try{vault=await createSessionVault({base64Key:sessionVaultKey});}
    catch{return reply(503,'SESSION_KEY_NOT_CONFIGURED');}
  }
  let ledger,dispatchId;
  try{
    dispatchId=makeWorkerId();
    if(!UUID.test(dispatchId))throw Error('INVALID_DISPATCH_ID');
    ledger=createServiceLedger({url:supabaseUrl,serviceRoleJwt,fetcher});
    const acquired=await ledger.acquireDispatch(dispatchId);
    if(acquired?.acquired===false)return reply(503,'WORKER_BUSY');
    if(acquired?.acquired!==true)throw Error('DISPATCH_PERMIT_UNVERIFIED');
  }catch{return reply(503,'DISPATCH_PERMIT_UNAVAILABLE');}
  // Only a positively verified step may release the permit. On crash,
  // unexpected response, lease expiry or ambiguous provider outcome it
  // intentionally persists until the original identities are reconciled.
  // No TTL, finally{} release, or automatic second attempt is allowed.
  const complete=async status=>{
    const receipt=await ledger.releaseDispatch(dispatchId);
    if(receipt?.released!==true)throw Error('DISPATCH_RELEASE_UNVERIFIED');
    return reply(200,status);
  };
  try{
    if(payload.operation==='advance_once'){
      // Leases are recovered exclusively from the service-only immutable
      // outbox; callers supply NO package/user/worker/file identities.
      const result=await advanceTrustedDeliveryOneStep({
        tokenProvider,ledger,makeWorkerId,
        expectedEmail:expectedAccount,expectedDriveId,fetcher,
        projectUrl:supabaseUrl,serviceRoleJwt,
        // The vault was validated before the original dispatch permit.
        makeVault:async()=>vault
      });
      if(result.state==='NO_ELIGIBLE_PACKAGES')
        return await complete('NO_ELIGIBLE_PACKAGES');
      if(result.state==='PARENT_STEP_VERIFIED')
        return await complete('PARENT_STEP_VERIFIED');
      if(result.state==='PACKAGE_IDENTITIES_PREALLOCATED')
        return await complete('PREALLOCATED_ONLY');
      if(result.state==='PACKAGE_FOLDER_STEP_VERIFIED')
        return await complete('FOLDER_STEP_VERIFIED');
      if(result.state==='FILE_STEP_VERIFIED')
        return await complete('FILE_STEP_VERIFIED');
      if(result.state==='FILE_STEP_PENDING')
        return await complete('FILE_STEP_PENDING');
      if(result.state==='PACKAGE_DELIVERED')
        return await complete('FINAL_DELIVERY_VERIFIED');
      if(result.state==='FINAL_PROVIDER_RECHECK_REQUIRED')
        return await complete('FINAL_PROVIDER_RECHECK_REQUIRED');
      return reply(503,'TRUSTED_STEP_UNVERIFIED');
    }
    if(payload.operation==='preallocate'){
      const result=await prepareTrustedDelivery({
        tokenProvider,ledger,workerId:makeWorkerId(),
        expectedEmail:expectedAccount,expectedDriveId,fetcher
      });
      if(result.claimed===false)return await complete('NO_ELIGIBLE_PACKAGES');
      if(result.provider_writes_performed!==false)
        return reply(503,'PROVIDER_NOT_READY');
      return await complete('PREALLOCATED_ONLY');
    }
    const lease={
      tokenProvider,ledger,workerId:payload.worker_id,
      generation:payload.generation,packageId:payload.package_id,
      expectedEmail:expectedAccount,expectedDriveId,fetcher
    };
    let result;
    if(payload.operation==='reconcile_parent')
      result=await continueTrustedDeliveryParent({...lease,kind:payload.kind});
    else if(payload.operation==='reconcile_geographic_leaf')
      result=await continueTrustedGeographicLeaf({...lease,kind:payload.kind});
    else if(payload.operation==='reconcile_package_folder')
      result=await continueTrustedPackageFolder({...lease,planId:payload.plan_id});
    else if(payload.operation==='transfer_one_chunk'){
      // The protected AES-GCM key was validated before taking the permit.
      // A wrong historical key still fails closed on original ciphertext.
      result=await continueTrustedDeliveryFile({...lease,planId:payload.plan_id,
        projectUrl:supabaseUrl,serviceRoleJwt,vault});
    }
    if(result?.state==='PARENT_VERIFIED'
      ||result?.state==='FOLDER_VERIFIED')return await complete('FOLDER_STEP_VERIFIED');
    if(['FILE_VERIFIED','PROGRESS','NEEDS_INDEPENDENT_GET'].includes(result?.state))
      return await complete(result.state==='FILE_VERIFIED'?'FILE_STEP_VERIFIED':'FILE_STEP_PENDING');
    return reply(503,'TRUSTED_STEP_UNVERIFIED');
  }catch {
    // Never expose a live OAuth token, session URI, Supabase key, package ID
    // or provider error body in responses to callers.
    return reply(503,'TRUSTED_PROVIDER_UNAVAILABLE');
  }
 };
}
