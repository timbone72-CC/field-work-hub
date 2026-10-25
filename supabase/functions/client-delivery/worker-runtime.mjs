// Trusted-worker composition for preflight ONLY. This module creates NO
// external files, never schedules itself, and cannot mark a package Delivered.
// Until real provider evidence passes the phase gate, readiness stays OFF.
import {createDriveClient,DriveUncertain} from './drive-client.mjs';
import {reserveProviderIdentities} from './worker-core.mjs';
import {createPrivateSourceChunkReader} from './private-source.mjs';
import {transferOnePreparedChunk} from './upload-one.mjs';
import {reconcileOnePreallocatedPackageFolder} from './folder-one.mjs';
import {reconcileOnePreallocatedParent} from './parent-one.mjs';
/**
 * Phase 5D original-ID recovery reconnaissance, SOURCE ONLY / NO route.
 * This is intentionally not lease recovery: a new service-only read RPC
 * must be installed and independently checked before anything invokes it.
 * Exactly one saved TEST ADDRESS identity is inspected; no SQL/Google write.
 */
export async function inspectExpiredReservedParent({
  ledger,tokenProvider,expectedEmail,expectedDriveId,
  testPackageId,testDestinationId,testRootId,fetcher=fetch
}={}){
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const fullUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const id=/^[A-Za-z0-9_-]{10,160}$/;
  const sha=/^[a-f0-9]{64}$/;
  if(typeof ledger?.readExpiredReservation!=='function'
    ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||!id.test(expectedDriveId??'')
    ||!fullUuid.test(testPackageId??'')
    ||!fullUuid.test(testDestinationId??'')
    ||!id.test(testRootId??''))
    throw new DriveUncertain('RECOVERY_INSPECTION_NOT_CONFIGURED');
  // Only the service-role database can return this exact frozen identity.
  // No caller-selected folder, lease, package or replacement ID is accepted.
  const s=await ledger.readExpiredReservation(
    testPackageId,testDestinationId,testRootId);
  const p=s?.parent,m=s?.manifest;
  if(s?.state!=='EXPIRED_RESERVED_PARENT'
    ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
    ||!fullUuid.test(s.worker_id??'')||s.generation!==1||s.attempts!==1
    ||!sha.test(s.approved_sha256??'')
    ||m?.package_id!==testPackageId||m?.destination_id!==testDestinationId
    ||m?.destination_root!==testRootId
    ||!Array.isArray(m.selected_photos)||m.selected_photos.length!==2
    ||m.selected_photos.some(x=>!fullUuid.test(x?.photo_id??''))
    ||s.file_plans!==0||s.upload_sessions!==0||s.final_receipts!==0
    ||s.dispatch_permits!==0
    ||typeof s.lease_until!=='string'
    ||!Number.isFinite(Date.parse(s.lease_until))
    ||Date.parse(s.lease_until)>=Date.now()
    ||p?.kind!=='ADDRESS'||p.state!=='RESERVED'
    ||!fullUuid.test(p.map_id??'')||p.create_attempts!==0
    ||!id.test(p.remote_folder_id??'')||p.remote_folder_id===testRootId
    ||p.parent_remote_id!==testRootId)
    throw new DriveUncertain('EXPIRED_ORIGINAL_IDENTITY_UNVERIFIED');
  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  await drive.verifyProviderIdentity(expectedEmail);
  const root=await drive.verifyDestination({
    folderId:testRootId,expectedDriveId
  });
  if(root.id!==testRootId)
    throw new DriveUncertain('DESTINATION_NOT_VERIFIED');
  const found=await drive.inspectOriginalFolderId(p.remote_folder_id);
  if(found?.state!=='NOT_FOUND')
    throw new DriveUncertain('ORIGINAL_FOLDER_REQUIRES_RECONCILIATION');
  // Observation only. A later dedicated service-only transactional CAS must
  // recheck all saved identities, attempts and remote evidence before any
  // renewal of the ORIGINAL lease; this result is not that authorization.
  return Object.freeze({state:'ORIGINAL_RESERVED_ID_NOT_FOUND',
    package_id:s.package_id,worker_id:s.worker_id,
    generation:s.generation,map_id:p.map_id,
    remote_folder_id:p.remote_folder_id,
    approved_sha256:s.approved_sha256,lease_until:s.lease_until,
    observed_at:new Date().toISOString()});
}

/**
 * Internal trusted worker SOURCE-ONLY one-shot TEST recovery. No Edge route.
 * Require a new real same-ID Drive read within this invocation, then submit
 * only original lease/parent IDs to the additive service-role SQL CAS.
 * The CAS audits precisely one recovery and never increments attempts/gen.
 * If the RPC response is lost, STOP; never call again on speculation.
 */
export async function resumeInspectedExpiredTestLease({
  ledger,makeRequestId=()=>crypto.randomUUID(),testPackageId,
  testDestinationId,testRootId,...inspection
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(typeof ledger?.recoverAndAcquireDispatch!=='function'
    ||typeof makeRequestId!=='function')
    throw new DriveUncertain('RECOVERY_CAS_NOT_CONFIGURED');
  const report=await inspectExpiredReservedParent({
    ledger,testPackageId,testDestinationId,testRootId,...inspection
  });
  if(report.state!=='ORIGINAL_RESERVED_ID_NOT_FOUND')
    throw new DriveUncertain('ORIGINAL_REMOTE_ABSENCE_NOT_PROVED');
  const requestId=makeRequestId();
  if(!UUID.test(requestId))
    throw new DriveUncertain('RECOVERY_CAS_NOT_CONFIGURED');
  const resumed=await ledger.recoverAndAcquireDispatch({
    package_id:report.package_id,destination_id:testDestinationId,
    root_id:testRootId,worker_id:report.worker_id,
    generation:report.generation,map_id:report.map_id,
    remote_folder_id:report.remote_folder_id,
    lease_until:report.lease_until,observed_at:report.observed_at,
    request_id:requestId
  });
  if(resumed?.status!=='ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED'
    ||resumed.dispatch_id!==requestId
    ||resumed.package_id!==report.package_id
    ||resumed.worker_id!==report.worker_id
    ||resumed.generation!==report.generation
    ||resumed.map_id!==report.map_id
    ||resumed.remote_folder_id!==report.remote_folder_id
    ||typeof resumed.expires_at!=='string')
    throw new DriveUncertain('RECOVERY_CAS_CONFIRMATION_UNCERTAIN');
  return Object.freeze({state:'ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED',
    package_id:report.package_id,worker_id:report.worker_id,
    generation:report.generation,original_map_id:report.map_id,
    dispatch_id:requestId});
}

/**
 * ONE controlled TEST parent step after the original expired lease.
 * No client-chosen worker/ID, no second provider CREATE, no automatic retry.
 * Fresh original-ID Google GET then ONE SQL transaction must recover the
 * lease AND take the non-expiring global dispatch permit. Lost confirmation,
 * concurrent permit or crash stops; never issue a speculative second CAS.
 * The permit remains held across the subsequent provider write.
 */
export async function recoverAndContinueOriginalTestParentOnce({
  ledger,tokenProvider,expectedEmail,expectedDriveId,
  testPackageId,testDestinationId,testRootId,
  makeRequestId=()=>crypto.randomUUID(),
  fetcher=fetch
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const required=['readExpiredReservation','recoverAndAcquireDispatch',
    'releaseDispatch','heartbeat','readParent',
    'beginParentCreate','confirmParent'];
  if(!ledger||required.some(k=>typeof ledger[k]!=='function')
    ||typeof tokenProvider!=='function'
    ||typeof makeRequestId!=='function')
    throw new DriveUncertain('ORIGINAL_TEST_RECOVERY_NOT_CONFIGURED');

  // The refresh is shared with the subsequent parent continuation. Recheck
  // the same account and original root from the frozen backend before CAS.
  let token;
  const once=async()=>{
    if(!token)token=await tokenProvider();
    return token;
  };
  const proof=await resumeInspectedExpiredTestLease({
    ledger,tokenProvider:once,expectedEmail,expectedDriveId,
    testPackageId,testDestinationId,testRootId,makeRequestId,fetcher
  });
  if(proof?.state!=='ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED'
    ||proof.package_id!==testPackageId||!UUID.test(proof.worker_id??'')
    ||proof.generation!==1||!UUID.test(proof.original_map_id??'')
    ||!UUID.test(proof.dispatch_id??''))
    throw new DriveUncertain('ORIGINAL_TEST_RECOVERY_UNVERIFIED');
  const dispatchId=proof.dispatch_id;
  // If ANY provider or SQL observation becomes uncertain, intentionally
  // leave the durable dispatch permit held: no blind replay or new file ID.
  const result=await continueTrustedDeliveryParent({
    ledger,tokenProvider:once,expectedEmail,expectedDriveId,
    workerId:proof.worker_id,packageId:proof.package_id,
    generation:proof.generation,kind:'ADDRESS',fetcher
  });
  if(result?.state!=='PARENT_VERIFIED'
    ||result.map_id!==proof.original_map_id
    ||result.kind!=='ADDRESS')
    throw new DriveUncertain('ORIGINAL_TEST_PARENT_OUTCOME_UNCERTAIN');
  const released=await ledger.releaseDispatch(dispatchId);
  if(released?.released!==true)
    throw new DriveUncertain('DISPATCH_RELEASE_UNVERIFIED');
  return Object.freeze({state:'ORIGINAL_TEST_PARENT_VERIFIED'});
}

/**
 * Phase 5D: reconcile ONE already-created, exact original TEST Google folder.
 * This is NOT the original expired-lease recovery path. It never POSTs to
 * Google, renews a different worker, creates a new ID or re-acquires a permit.
 * If the atomic SQL result is lost, STOP with the original permit held.
 */
export async function reconcileOriginalAttemptedTestParentOnce({
  ledger,tokenProvider,expectedEmail,expectedDriveId,
  testPackageId,testDestinationId,testRootId,fetcher=fetch
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const ID=/^[A-Za-z0-9_-]{10,160}$/;
  const HASH=/^[0-9a-f]{64}$/;
  if(!ledger||!['readAttemptedExactTestParent','commitAttemptedExactTestParent',
        'releaseDispatch'].every(x=>typeof ledger[x]==='function')
    ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||!ID.test(expectedDriveId??'')||!ID.test(testRootId??'')
    ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??''))
    throw new DriveUncertain('EXACT_TEST_RECONCILIATION_NOT_CONFIGURED');

  const s=await ledger.readAttemptedExactTestParent(
    testPackageId,testDestinationId,testRootId);
  const props=s?.appProperties;
  if(s?.state!=='ORIGINAL_ATTEMPTED_PARENT_HELD'
    ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
    ||s.root_id!==testRootId||s.parent_remote_id!==testRootId
    ||!UUID.test(s.worker_id??'')||s.generation!==1||s.attempts!==1
    ||!UUID.test(s.request_id??'')||!UUID.test(s.map_id??'')
    ||!HASH.test(s.approved_sha256??'')
    ||!ID.test(s.remote_folder_id??'')||s.remote_folder_id===testRootId
    ||s.drive_id!==expectedDriveId
    ||typeof s.remote_name!=='string'||s.remote_name.length<1
    ||!props||typeof props!=='object'||Array.isArray(props)
    ||Object.keys(props).sort().join(',')!==
      ['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'].sort().join(',')
    ||props.fwh_kind!=='ADDRESS'
    ||props.fwh_destination!==testDestinationId
    ||!UUID.test(props.fwh_org??'')||!UUID.test(props.fwh_company??'')
    ||!HASH.test(props.fwh_key??''))
    throw new DriveUncertain('EXACT_TEST_ATTEMPTED_PARENT_CHANGED');

  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  await drive.verifyProviderIdentity(expectedEmail);
  const root=await drive.verifyDestination({
    folderId:testRootId,expectedDriveId
  });
  if(root?.id!==testRootId||root?.drive_id!==expectedDriveId)
    throw new DriveUncertain('EXACT_TEST_ROOT_CHANGED');

  const receipt=await drive.verifyFile({
    id:s.remote_folder_id,parent:s.parent_remote_id,
    name:s.remote_name,mime:'application/vnd.google-apps.folder',
    expectedDriveId,sha256:null,size:null,appProperties:props
  });
  if(receipt?.id!==s.remote_folder_id
    ||receipt.parent!==testRootId||receipt.drive_id!==expectedDriveId
    ||receipt.name!==s.remote_name||receipt.trashed!==false
    ||receipt.mime!=='application/vnd.google-apps.folder')
    throw new DriveUncertain('EXACT_TEST_REMOTE_RECEIPT_UNVERIFIED');

  // Captured ONLY AFTER the complete real Google GET; SQL enforces <=30s.
  const observedAt=new Date().toISOString();
  const committed=await ledger.commitAttemptedExactTestParent({
    package_id:testPackageId,destination_id:testDestinationId,root_id:testRootId,
    worker_id:s.worker_id,generation:1,map_id:s.map_id,
    request_id:s.request_id
  },observedAt,receipt);
  if(committed?.status!=='ORIGINAL_TEST_PARENT_RECONCILED'
    ||committed.package_id!==testPackageId
    ||committed.worker_id!==s.worker_id
    ||committed.generation!==1||committed.map_id!==s.map_id
    ||committed.remote_folder_id!==s.remote_folder_id
    ||committed.dispatch_id!==s.request_id
    ||committed.permit_held!==true)
    throw new DriveUncertain('ORIGINAL_TEST_RECONCILIATION_UNVERIFIED');

  // This existing singleflight owner may release ONLY the same request's
  // permit after the atomic ledger receipt is known committed.
  const released=await ledger.releaseDispatch(s.request_id);
  if(released?.released!==true)
    throw new DriveUncertain('ORIGINAL_TEST_PERMIT_RELEASE_UNVERIFIED');
  return Object.freeze({state:'ORIGINAL_TEST_PARENT_RECONCILED'});
}

/**
 * One manual, disposable TEST step AFTER the original ADDRESS is VERIFIED:
 * independently re-GET the immutable parent, atomically resume its original
 * worker + acquire the global permit, then reserve and reconcile ONE WO child.
 * Never retry an uncertain DB or Drive result. A crash intentionally holds
 * the singleflight permit and persisted original identities for inspection.
 */
export async function continueOriginalVerifiedTestToWorkOrderOnce({
  ledger,tokenProvider,expectedEmail,expectedDriveId,
  testPackageId,testDestinationId,testRootId,fetcher=fetch,
  makeRequestId=()=>crypto.randomUUID()
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const ID=/^[A-Za-z0-9_-]{10,160}$/;
  const HASH=/^[a-f0-9]{64}$/;
  if(!ledger||!['readVerifiedOriginalTestParent',
    'resumeVerifiedOriginalAndAcquireDispatch','heartbeat','readParent',
    'reserveParent','beginParentCreate','confirmParent','releaseDispatch']
    .every(k=>typeof ledger[k]==='function')
    ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
    ||typeof makeRequestId!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||!ID.test(expectedDriveId??'')||!ID.test(testRootId??'')
    ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??''))
    throw new DriveUncertain('VERIFIED_TEST_WO_CONTINUATION_NOT_CONFIGURED');

  const s=await ledger.readVerifiedOriginalTestParent(
    testPackageId,testDestinationId,testRootId);
  const props=s?.appProperties;
  if(s?.state!=='ORIGINAL_VERIFIED_PARENT_EXPIRED'
    ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
    ||s.root_id!==testRootId||s.parent_remote_id!==testRootId
    ||!UUID.test(s.worker_id??'')||s.generation!==1||s.attempts!==1
    ||!UUID.test(s.map_id??'')||!UUID.test(s.request_id??'')
    ||!HASH.test(s.approved_sha256??'')
    ||!ID.test(s.remote_folder_id??'')||s.remote_folder_id===testRootId
    ||s.drive_id!==expectedDriveId
    ||typeof s.lease_until!=='string'
    ||!Number.isFinite(Date.parse(s.lease_until))
    ||Date.parse(s.lease_until)>=Date.now()
    ||typeof s.remote_name!=='string'||s.remote_name.length<3
    ||!props||typeof props!=='object'||Array.isArray(props)
    ||Object.keys(props).sort().join(',')!==
       ['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'].sort().join(',')
    ||props.fwh_kind!=='ADDRESS'||props.fwh_destination!==testDestinationId
    ||!UUID.test(props.fwh_org??'')||!UUID.test(props.fwh_company??'')
    ||!HASH.test(props.fwh_key??'')
    ||typeof s.remote_evidence!=='object'||s.remote_evidence===null)
    throw new DriveUncertain('VERIFIED_ORIGINAL_TEST_IDENTITY_CHANGED');

  let token;
  try{token=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof token?.accessToken!=='string'||token.accessToken.length<20
    ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:token.accessToken,fetcher});
  await drive.verifyProviderIdentity(expectedEmail);
  const root=await drive.verifyDestination({
    folderId:testRootId,expectedDriveId
  });
  if(root?.id!==testRootId||root.drive_id!==expectedDriveId)
    throw new DriveUncertain('VERIFIED_ORIGINAL_TEST_ROOT_CHANGED');
  const proof=await drive.verifyFile({
    id:s.remote_folder_id,parent:testRootId,name:s.remote_name,
    mime:'application/vnd.google-apps.folder',expectedDriveId,
    sha256:null,size:null,appProperties:props
  });
  if(proof?.id!==s.remote_folder_id||proof.parent!==testRootId
    ||proof.drive_id!==expectedDriveId||proof.trashed!==false
    ||!s.remote_evidence||typeof s.remote_evidence!=='object'
    ||Object.keys(proof).sort().join(',')!==
       Object.keys(s.remote_evidence).sort().join(',')
    ||Object.keys(proof).some(k=>k==='appProperties'
      ? Object.keys(proof.appProperties).sort().join(',')!==
           Object.keys(s.remote_evidence.appProperties??{}).sort().join(',')
        ||Object.keys(proof.appProperties).some(n=>
           proof.appProperties[n]!==s.remote_evidence.appProperties[n])
      : proof[k]!==s.remote_evidence[k]))
    throw new DriveUncertain('VERIFIED_ORIGINAL_TEST_PROVIDER_PROOF_CHANGED');

  const requestId=makeRequestId();
  if(!UUID.test(requestId))
    throw new DriveUncertain('VERIFIED_TEST_DISPATCH_REQUEST_INVALID');
  // Fresh observation only after provider GET. A replayed or delayed proof
  // fails the service-role atomic CAS; no speculative second attempt.
  const resumed=await ledger.resumeVerifiedOriginalAndAcquireDispatch({
    package_id:testPackageId,destination_id:testDestinationId,root_id:testRootId,
    worker_id:s.worker_id,generation:1,map_id:s.map_id,
    remote_folder_id:s.remote_folder_id,lease_until:s.lease_until
  },proof,new Date().toISOString(),requestId);
  if(resumed?.status!=='ORIGINAL_VERIFIED_PARENT_LEASE_AND_DISPATCH_ACQUIRED'
    ||resumed.package_id!==testPackageId||resumed.worker_id!==s.worker_id
    ||resumed.generation!==1||resumed.map_id!==s.map_id
    ||resumed.remote_folder_id!==s.remote_folder_id
    ||resumed.dispatch_id!==requestId
    ||typeof resumed.expires_at!=='string'
    ||Date.parse(resumed.expires_at)<=Date.now())
    throw new DriveUncertain('VERIFIED_TEST_LEASE_DISPATCH_UNCERTAIN');

  const pkg=testPackageId,worker=s.worker_id,gen=1;
  // Never generate a replacement if an original WO child already exists.
  await ledger.heartbeat(pkg,worker,gen);
  const existing=await ledger.readParent(pkg,worker,gen,'WORK_ORDER');
  if(existing?.exists!==false||existing.kind!=='WORK_ORDER')
    throw new DriveUncertain('ORIGINAL_WORK_ORDER_PARENT_REQUIRES_RECONCILIATION');
  const ids=await drive.generateIds(1);
  if(!Array.isArray(ids)||ids.length!==1
    ||!ID.test(ids[0])||ids[0]===s.remote_folder_id)
    throw new DriveUncertain('WORK_ORDER_ID_PREALLOCATION_UNCERTAIN');
  // Reserve exact immutable ID in SQL BEFORE any create; unknown reservation
  // outcome leaves permit held, NEVER repeats generateIds or CREATE.
  const reservation=await ledger.reserveParent(
    pkg,worker,gen,'WORK_ORDER',ids[0],s.remote_folder_id);
  if(reservation?.kind!=='WORK_ORDER'
    ||reservation.remote_folder_id!==ids[0]
    ||reservation.parent_remote_id!==s.remote_folder_id
    ||reservation.state!=='RESERVED'
    ||!UUID.test(reservation.map_id??''))
    throw new DriveUncertain('ORIGINAL_WO_RESERVATION_UNCERTAIN');

  const result=await continueTrustedDeliveryParent({
    ledger,tokenProvider:async()=>token,workerId:worker,generation:gen,
    packageId:pkg,kind:'WORK_ORDER',expectedEmail,expectedDriveId,fetcher
  });
  if(result?.state!=='PARENT_VERIFIED'
    ||result.kind!=='WORK_ORDER'||result.map_id!==reservation.map_id)
    throw new DriveUncertain('ORIGINAL_WO_PROVIDER_RESULT_UNCERTAIN');
  // The existing parent reconciler performs a Google GET and confirmation,
  // but do not release singleflight merely on its in-memory return. Demand
  // independently re-read durable state under the same worker's live lease.
  const persisted=await ledger.readParent(pkg,worker,gen,'WORK_ORDER');
  if(persisted?.exists!==true||persisted.kind!=='WORK_ORDER'
    ||persisted.state!=='VERIFIED'
    ||persisted.map_id!==reservation.map_id
    ||persisted.remote_folder_id!==ids[0]
    ||persisted.parent_remote_id!==s.remote_folder_id)
    throw new DriveUncertain('ORIGINAL_WO_DURABLE_RECEIPT_UNVERIFIED');
  const released=await ledger.releaseDispatch(requestId);
  if(released?.released!==true)
    throw new DriveUncertain('ORIGINAL_WO_DISPATCH_RELEASE_UNVERIFIED');
  return Object.freeze({state:'ORIGINAL_TEST_WORK_ORDER_VERIFIED'});
}

/**
 * Disposable TEST: original VERIFIED WORK_ORDER -> ONE PACKAGE folder.
 * Freshly GET-verify saved parent and child; one atomic same-worker lease +
 * dispatch CAS, existing atomic file-ID reservation and one-shot folder owner.
 * Any uncertain response leaves durable original IDs / dispatch untouched.
 */
export async function continueOriginalVerifiedTestToPackageOnce({
 ledger,tokenProvider,expectedEmail,expectedDriveId,
 testPackageId,testDestinationId,testRootId,fetcher=fetch,
 makeRequestId=()=>crypto.randomUUID()
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const ID=/^[A-Za-z0-9_-]{10,160}$/;
 const HASH=/^[a-f0-9]{64}$/;
 const needed=['readVerifiedOriginalTestWOForPackage',
   'resumeVerifiedWOAndAcquirePackageDispatch','heartbeat','readParent',
   'nextReservedItem','reserveBatch','forLease','releaseDispatch'];
 if(!ledger||needed.some(k=>typeof ledger[k]!=='function')
   ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
   ||typeof makeRequestId!=='function'
   ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??'')
   ||!ID.test(expectedDriveId??'')||!ID.test(testRootId??'')
   ||typeof expectedEmail!=='string'||!expectedEmail)
  throw new DriveUncertain('VERIFIED_TEST_PACKAGE_CONTINUATION_NOT_CONFIGURED');
 const s=await ledger.readVerifiedOriginalTestWOForPackage(
   testPackageId,testDestinationId,testRootId);
 const props=s?.appProperties,parentProps=s?.parent_appProperties;
 if(s?.state!=='ORIGINAL_VERIFIED_WORK_ORDER_EXPIRED'
   ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
   ||s.root_id!==testRootId||!UUID.test(s.worker_id??'')
   ||s.generation!==1||s.attempts!==1||!UUID.test(s.map_id??'')
   ||!HASH.test(s.approved_sha256??'')
   ||!ID.test(s.remote_folder_id??'')||!ID.test(s.parent_remote_id??'')
   ||new Set([s.remote_folder_id,s.parent_remote_id,testRootId]).size!==3
   ||s.drive_id!==expectedDriveId
   ||typeof s.lease_until!=='string'||Date.parse(s.lease_until)>=Date.now()
   ||!Number.isFinite(Date.parse(s.lease_until))
   ||typeof s.remote_name!=='string'||s.remote_name.length<3
   ||typeof s.parent_name!=='string'||s.parent_name.length<3
   ||!props||!parentProps
   ||Object.keys(props).sort().join(',')!==
      ['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'].sort().join(',')
   ||Object.keys(parentProps).sort().join(',')!==
      ['fwh_org','fwh_company','fwh_destination','fwh_kind','fwh_key'].sort().join(',')
   ||props.fwh_kind!=='WORK_ORDER'||parentProps.fwh_kind!=='ADDRESS'
   ||props.fwh_destination!==testDestinationId
   ||parentProps.fwh_destination!==testDestinationId
   ||!UUID.test(props.fwh_org??'')||!UUID.test(props.fwh_company??'')
   ||props.fwh_org!==parentProps.fwh_org
   ||props.fwh_company!==parentProps.fwh_company
   ||typeof props.fwh_key!=='string'||!props.fwh_key
   ||!HASH.test(parentProps.fwh_key??'')
   ||!s.remote_evidence||!s.parent_evidence
   ||!Array.isArray(s.selected_photos)||s.selected_photos.length!==2
   ||new Set(s.selected_photos.map(p=>p.photo_id)).size!==2
   ||s.selected_photos.some(p=>!UUID.test(p.photo_id??'')
      ||!HASH.test(p.observed_sha256??'')
      ||!Number.isSafeInteger(p.observed_size)||p.observed_size<=0))
   throw new DriveUncertain('VERIFIED_TEST_PACKAGE_IDENTITY_CHANGED');

 let token;
 try{token=await tokenProvider();}
 catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof token?.accessToken!=='string'||token.accessToken.length<20
   ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
   throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:token.accessToken,fetcher});
 await drive.verifyProviderIdentity(expectedEmail);
 const root=await drive.verifyDestination({folderId:testRootId,expectedDriveId});
 if(root?.id!==testRootId||root.drive_id!==expectedDriveId)
   throw new DriveUncertain('VERIFIED_TEST_ROOT_CHANGED');
 const parent=await drive.verifyFile({id:s.parent_remote_id,parent:testRootId,
   name:s.parent_name,mime:'application/vnd.google-apps.folder',
   expectedDriveId,sha256:null,size:null,appProperties:parentProps});
 const proof=await drive.verifyFile({id:s.remote_folder_id,parent:s.parent_remote_id,
   name:s.remote_name,mime:'application/vnd.google-apps.folder',
   expectedDriveId,sha256:null,size:null,appProperties:props});
 const same=(a,b)=>a&&b
   &&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')
   &&Object.keys(a).every(k=>k==='appProperties'
     ?a[k]&&b[k]&&Object.keys(a[k]).sort().join(',')===Object.keys(b[k]).sort().join(',')
       &&Object.keys(a[k]).every(n=>a[k][n]===b[k][n])
     :a[k]===b[k]);
 if(!same(parent,s.parent_evidence)||!same(proof,s.remote_evidence))
   throw new DriveUncertain('VERIFIED_ORIGINAL_WO_PROVIDER_PROOF_CHANGED');

 const requestId=makeRequestId();
 if(!UUID.test(requestId))
   throw new DriveUncertain('VERIFIED_TEST_PACKAGE_REQUEST_INVALID');
 const resumed=await ledger.resumeVerifiedWOAndAcquirePackageDispatch({
   package_id:testPackageId,destination_id:testDestinationId,root_id:testRootId,
   worker_id:s.worker_id,generation:1,map_id:s.map_id,
   remote_folder_id:s.remote_folder_id,lease_until:s.lease_until
 },proof,new Date().toISOString(),requestId);
 if(resumed?.status!=='ORIGINAL_VERIFIED_WO_LEASE_AND_DISPATCH_ACQUIRED'
   ||resumed.package_id!==testPackageId||resumed.worker_id!==s.worker_id
   ||resumed.generation!==1||resumed.map_id!==s.map_id
   ||resumed.remote_folder_id!==s.remote_folder_id
   ||resumed.dispatch_id!==requestId
   ||typeof resumed.expires_at!=='string'
   ||Date.parse(resumed.expires_at)<=Date.now())
   throw new DriveUncertain('VERIFIED_TEST_PACKAGE_LEASE_DISPATCH_UNCERTAIN');

 const pkg=testPackageId,workerId=s.worker_id,generation=1;
 await ledger.heartbeat(pkg,workerId,generation);
 const wo=await ledger.readParent(pkg,workerId,generation,'WORK_ORDER');
 if(wo?.exists!==true||wo.kind!=='WORK_ORDER'
   ||wo.state!=='VERIFIED'||wo.map_id!==s.map_id
   ||wo.remote_folder_id!==s.remote_folder_id
   ||wo.parent_remote_id!==s.parent_remote_id)
   throw new DriveUncertain('ORIGINAL_VERIFIED_WO_CHANGED_AFTER_CAS');
 const item=await ledger.nextReservedItem(pkg,workerId,generation);
 if(item?.state!=='UNRESERVED')
   throw new DriveUncertain('ORIGINAL_PACKAGE_IDS_REQUIRE_RECONCILIATION');
 const ids=await drive.generateIds(s.selected_photos.length+2);
 if(!Array.isArray(ids)||ids.length!==4||ids.some(id=>!ID.test(id))
   ||new Set([...ids,s.remote_folder_id,s.parent_remote_id,testRootId]).size!==7)
   throw new DriveUncertain('ORIGINAL_PACKAGE_ID_PREALLOCATION_UNCERTAIN');
 // One SQL transaction records every remote identity BEFORE any provider CREATE.
 const saved=await ledger.reserveBatch(pkg,workerId,generation,ids[0],
   s.remote_folder_id,s.selected_photos.map((p,i)=>({
     photo_id:p.photo_id,file_id:ids[i+1]})),ids.at(-1));
 if(saved?.reserved!==true||saved.package_id!==pkg
   ||saved.folder_id!==ids[0]||saved.manifest_id!==ids.at(-1)
   ||saved.reserved_count!==4)
   throw new DriveUncertain('ORIGINAL_PACKAGE_RESERVATION_UNCERTAIN');
 const next=await ledger.nextReservedItem(pkg,workerId,generation);
 if(next?.state!=='FOLDER'||!UUID.test(next.plan_id??''))
   throw new DriveUncertain('ORIGINAL_PACKAGE_FOLDER_PLAN_UNCERTAIN');
 const done=await continueTrustedPackageFolder({
   tokenProvider:async()=>token,ledger,workerId,generation,packageId:pkg,
   planId:next.plan_id,expectedEmail,expectedDriveId,fetcher});
 if(done?.state!=='FOLDER_VERIFIED'||done.plan_id!==next.plan_id)
   throw new DriveUncertain('ORIGINAL_PACKAGE_FOLDER_PROVIDER_UNVERIFIED');
 // Re-read the authoritative SQL folder receipt, never trust POST or memory.
 const persisted=await ledger.forLease(pkg,workerId,generation)
   .getFolderPlan(next.plan_id);
 if(persisted?.state!=='VERIFIED'||persisted.plan_id!==next.plan_id
   ||persisted.package_id!==pkg||persisted.file_id!==ids[0]
   ||persisted.parent_id!==s.remote_folder_id
   ||persisted.name!=='package-'+pkg)
   throw new DriveUncertain('ORIGINAL_PACKAGE_FOLDER_DURABLE_RECEIPT_UNVERIFIED');
 const released=await ledger.releaseDispatch(requestId);
 if(released?.released!==true)
   throw new DriveUncertain('ORIGINAL_PACKAGE_DISPATCH_RELEASE_UNVERIFIED');
 return Object.freeze({state:'ORIGINAL_TEST_PACKAGE_FOLDER_VERIFIED'});
}

/**
 * One approved disposable TEST photo step using already-preallocated IDs.
 * Only the original expired worker + original package may obtain the
 * transactionally fenced lease/permit. Existing encrypted upload and private
 * source implementations own every byte and Google session.
 * No retry, replacement ID, new worker, delivery finish, or cleanup.
 */
/**
 * Phase 5D: one-shot, ORIGINAL TEST saved-session continuation after expired
 * lease. Never generate a remote ID or new upload session. A provider GET of
 * the existing package folder precedes atomic same-worker lease/dispatch CAS.
 * The existing chunk engine probes the sealed Google session BEFORE any PUT.
 */
export async function continueOriginalTestSavedFirstPhotoOnce({
 ledger,tokenProvider,expectedEmail,expectedDriveId,
 testPackageId,testDestinationId,testRootId,projectUrl,serviceRoleJwt,
 vault,fetcher=fetch,makeRequestId=()=>crypto.randomUUID(),
 continueFile=continueTrustedDeliveryFile
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const ID=/^[A-Za-z0-9_-]{10,160}$/;
 const HASH=/^[a-f0-9]{64}$/;
 if(!ledger||['readSavedTestFirstPhoto','resumeSavedTestFirstPhoto',
   'nextReservedItem','forLease','releaseDispatch'].some(k=>typeof ledger[k]!=='function')
  ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
  ||typeof continueFile!=='function'||typeof makeRequestId!=='function'
  ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??'')
  ||!ID.test(testRootId??'')||!ID.test(expectedDriveId??'')
  ||typeof expectedEmail!=='string'||!expectedEmail
  ||typeof projectUrl!=='string'||!projectUrl
  ||typeof serviceRoleJwt!=='string'||!serviceRoleJwt
  ||!vault||typeof vault.seal!=='function'||typeof vault.open!=='function')
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_NOT_CONFIGURED');
 const s=await ledger.readSavedTestFirstPhoto(
  testPackageId,testDestinationId,testRootId);
 if(s?.state!=='ORIGINAL_TEST_FIRST_PHOTO_SAVED_PROGRESS_EXPIRED'
  ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
  ||s.root_id!==testRootId||!UUID.test(s.worker_id??'')
  ||s.generation!==1||s.attempts!==1||!HASH.test(s.approved_sha256??'')
  ||!UUID.test(s.folder_plan_id??'')||!UUID.test(s.photo_plan_id??'')
  ||!UUID.test(s.photo_id??'')||!HASH.test(s.photo_sha256??'')
  ||!ID.test(s.folder_remote_id??'')||!ID.test(s.folder_parent_id??'')
  ||!ID.test(s.photo_remote_id??'')
  ||s.photo_parent_id!==s.folder_remote_id
  ||s.drive_id!==expectedDriveId
  ||!Number.isSafeInteger(s.photo_size)||s.photo_size<1||s.photo_size>33554432
  ||s.session_state!=='UPLOADING'
  ||!Number.isSafeInteger(s.recorded_offset)||s.recorded_offset<1
  ||s.recorded_offset>=s.photo_size
  ||!Number.isSafeInteger(s.session_revision)||s.session_revision<3
  ||typeof s.lease_until!=='string'
  ||!Number.isFinite(Date.parse(s.lease_until))
  ||Date.parse(s.lease_until)>=Date.now()
  ||s.folder_name!=='package-'+testPackageId
  ||!s.folder_proof||s.folder_proof.id!==s.folder_remote_id
  ||s.folder_proof.parent!==s.folder_parent_id
  ||s.folder_proof.drive_id!==expectedDriveId
  ||s.folder_proof.name!==s.folder_name)
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_IDENTITY_CHANGED');
 let token;
 try{token=await tokenProvider();}
 catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof token?.accessToken!=='string'||token.accessToken.length<20
  ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
  throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:token.accessToken,fetcher});
 const account=await drive.verifyProviderIdentity(expectedEmail);
 if(account?.account?.toLowerCase()!==expectedEmail.toLowerCase())
  throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
 const root=await drive.verifyDestination({folderId:testRootId,expectedDriveId});
 if(root?.id!==testRootId||root.drive_id!==expectedDriveId)
  throw new DriveUncertain('ORIGINAL_TEST_ROOT_CHANGED');
 const proof=await drive.verifyFile({
  id:s.folder_remote_id,parent:s.folder_parent_id,
  name:s.folder_name,mime:'application/vnd.google-apps.folder',
  expectedDriveId,sha256:null,size:null,
  appProperties:s.folder_proof.appProperties
 });
 // Compare fresh Google GET to the original exact durable PACKAGE proof.
 if(!proof||JSON.stringify(Object.keys(proof).sort())!==
     JSON.stringify(Object.keys(s.folder_proof).sort())
   ||Object.keys(s.folder_proof).some(k=>k==='appProperties'
      ? !proof.appProperties
        ||JSON.stringify(Object.keys(proof.appProperties).sort())!==
           JSON.stringify(Object.keys(s.folder_proof.appProperties).sort())
        ||Object.keys(s.folder_proof.appProperties).some(n=>
           proof.appProperties[n]!==s.folder_proof.appProperties[n])
      : proof[k]!==s.folder_proof[k]))
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_FOLDER_PROOF_CHANGED');
 const request=makeRequestId();
 if(!UUID.test(request))throw new DriveUncertain('ORIGINAL_TEST_REQUEST_INVALID');
 // One SQL transaction commits unique progress journal, original lease CAS
 // and non-TTL global dispatch. Uncertain acknowledgement is STOP.
 const resumed=await ledger.resumeSavedTestFirstPhoto(s,proof,request);
 if(resumed?.status!=='ORIGINAL_TEST_SAVED_PHOTO_DISPATCH_ACQUIRED'
  ||resumed.package_id!==testPackageId||resumed.worker_id!==s.worker_id
  ||resumed.generation!==1||resumed.photo_plan_id!==s.photo_plan_id
  ||resumed.photo_remote_id!==s.photo_remote_id
  ||resumed.previous_offset!==s.recorded_offset
  ||resumed.previous_revision!==s.session_revision
  ||resumed.dispatch_id!==request
  ||!Number.isFinite(Date.parse(resumed.expires_at??''))
  ||Date.parse(resumed.expires_at)<=Date.now())
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_DISPATCH_UNVERIFIED');
 const next=await ledger.nextReservedItem(testPackageId,s.worker_id,1);
 if(next?.state!=='FILE'||next.kind!=='PHOTO'
  ||next.plan_id!==s.photo_plan_id)
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_QUEUE_CHANGED');
 const outcome=await continueFile({
  tokenProvider:async()=>token,ledger,workerId:s.worker_id,generation:1,
  packageId:testPackageId,planId:s.photo_plan_id,
  expectedEmail,expectedDriveId,projectUrl,serviceRoleJwt,vault,fetcher
 });
 if(outcome?.plan_id!==s.photo_plan_id
  ||!['FILE_VERIFIED','PROGRESS'].includes(outcome.state))
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_RESULT_UNVERIFIED');
 const nextAfter=await ledger.nextReservedItem(testPackageId,s.worker_id,1);
 if(outcome.state==='FILE_VERIFIED'){
  if(nextAfter?.state!=='FILE'||nextAfter.kind!=='PHOTO'
    ||nextAfter.plan_id===s.photo_plan_id)
   throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_RECEIPT_MISSING');
 }else{
  if(nextAfter?.state!=='FILE'||nextAfter.kind!=='PHOTO'
    ||nextAfter.plan_id!==s.photo_plan_id
    ||!Number.isSafeInteger(outcome.recorded_offset)
    ||outcome.recorded_offset<=s.recorded_offset
    ||outcome.recorded_offset>s.photo_size)
   throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_PROGRESS_UNVERIFIED');
  const entry=await ledger.forLease(testPackageId,s.worker_id,1)
    .getSession(s.photo_plan_id);
  if(!entry||entry.plan_id!==s.photo_plan_id
    ||entry.package_id!==testPackageId||entry.total_bytes!==s.photo_size
    ||entry.recorded_offset<outcome.recorded_offset||!entry.encrypted)
   throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_SESSION_NOT_DURABLE');
 }
 const released=await ledger.releaseDispatch(request);
 if(released?.released!==true)
  throw new DriveUncertain('ORIGINAL_TEST_SAVED_PHOTO_PERMIT_UNVERIFIED');
 return Object.freeze({state:outcome.state==='FILE_VERIFIED'
  ?'ORIGINAL_TEST_SAVED_FIRST_PHOTO_VERIFIED'
  :'ORIGINAL_TEST_SAVED_FIRST_PHOTO_PROGRESS_VERIFIED'});
}

export async function continueOriginalVerifiedTestFirstPhotoOnce({
 ledger,tokenProvider,expectedEmail,expectedDriveId,
 testPackageId,testDestinationId,testRootId,projectUrl,serviceRoleJwt,
 vault,fetcher=fetch,makeRequestId=()=>crypto.randomUUID(),
 continueFile=continueTrustedDeliveryFile
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const HASH=/^[a-f0-9]{64}$/;
 const ID=/^[A-Za-z0-9_-]{10,160}$/;
 if(!ledger||['readExactTestFirstPhoto','resumeExactTestFirstPhoto',
   'nextReservedItem','forLease','releaseDispatch'].some(k=>typeof ledger[k]!=='function')
  ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
  ||typeof continueFile!=='function'||typeof makeRequestId!=='function'
  ||!UUID.test(testPackageId??'')||!UUID.test(testDestinationId??'')
  ||!ID.test(testRootId??'')||!ID.test(expectedDriveId??'')
  ||typeof expectedEmail!=='string'||!expectedEmail
  ||typeof projectUrl!=='string'||!projectUrl
  ||typeof serviceRoleJwt!=='string'||!serviceRoleJwt
  ||!vault||typeof vault.seal!=='function'||typeof vault.open!=='function')
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_NOT_CONFIGURED');
 const s=await ledger.readExactTestFirstPhoto(
   testPackageId,testDestinationId,testRootId);
 if(s?.state!=='ORIGINAL_TEST_FIRST_PHOTO_EXPIRED'
  ||s.package_id!==testPackageId||s.destination_id!==testDestinationId
  ||s.root_id!==testRootId||!UUID.test(s.worker_id??'')
  ||s.generation!==1||s.attempts!==1||!HASH.test(s.approved_sha256??'')
  ||!UUID.test(s.folder_plan_id??'')||!UUID.test(s.photo_plan_id??'')
  ||!UUID.test(s.photo_id??'')||!HASH.test(s.photo_sha256??'')
  ||!Number.isSafeInteger(s.photo_size)||s.photo_size<1||s.photo_size>33554432
  ||!ID.test(s.folder_remote_id??'')||!ID.test(s.photo_remote_id??'')
  ||!ID.test(s.wo_remote_id??'')||!ID.test(s.wo_parent_id??'')
  ||new Set([testRootId,s.wo_parent_id,s.wo_remote_id,
    s.folder_remote_id,s.photo_remote_id]).size!==5
  ||s.photo_parent_id!==s.folder_remote_id||s.drive_id!==expectedDriveId
  ||typeof s.lease_until!=='string'||!Number.isFinite(Date.parse(s.lease_until))
  ||Date.parse(s.lease_until)>=Date.now()
  ||!s.folder_properties||!s.wo_properties
  ||s.folder_properties.fwh_package!==testPackageId
  ||s.folder_properties.fwh_manifest!==s.approved_sha256
  ||s.wo_properties.fwh_kind!=='WORK_ORDER'
  ||s.wo_properties.fwh_destination!==testDestinationId
  ||typeof s.folder_name!=='string'
  ||s.folder_name!=='package-'+testPackageId
  ||typeof s.wo_name!=='string'||!s.wo_name
  ||!s.folder_proof||!s.wo_proof)
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_IDENTITY_CHANGED');
 let token;
 try{token=await tokenProvider();}
 catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof token?.accessToken!=='string'||token.accessToken.length<20
   ||!Number.isInteger(token.expiresInSeconds)||token.expiresInSeconds<60)
   throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:token.accessToken,fetcher});
 const account=await drive.verifyProviderIdentity(expectedEmail);
 if(account?.account?.toLowerCase()!==expectedEmail.toLowerCase())
  throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
 const root=await drive.verifyDestination({folderId:testRootId,expectedDriveId});
 if(root?.id!==testRootId||root.drive_id!==expectedDriveId)
  throw new DriveUncertain('ORIGINAL_TEST_ROOT_CHANGED');
 const wo=await drive.verifyFile({
  id:s.wo_remote_id,parent:s.wo_parent_id,
  name:s.wo_name,mime:'application/vnd.google-apps.folder',
  expectedDriveId,sha256:null,size:null,appProperties:s.wo_properties
 });
 const proof=await drive.verifyFile({
  id:s.folder_remote_id,parent:s.wo_remote_id,
  name:s.folder_name,mime:'application/vnd.google-apps.folder',
  expectedDriveId,sha256:null,size:null,appProperties:s.folder_properties
 });
 const same=(a,b)=>a&&b&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')
  &&Object.keys(a).every(k=>k==='appProperties'
    ? a[k]&&b[k]&&Object.keys(a[k]).sort().join(',')===Object.keys(b[k]).sort().join(',')
      &&Object.keys(a[k]).every(n=>a[k][n]===b[k][n])
    : a[k]===b[k]);
 if(!same(wo,s.wo_proof)||!same(proof,s.folder_proof))
  throw new DriveUncertain('ORIGINAL_TEST_PROVIDER_PROOF_CHANGED');
 const request=makeRequestId();
 if(!UUID.test(request))throw new DriveUncertain('ORIGINAL_TEST_REQUEST_INVALID');
 // SQL commits the original lease, unique journal and non-TTL dispatch together.
 const resumed=await ledger.resumeExactTestFirstPhoto(s,proof,new Date().toISOString(),request);
 if(resumed?.status!=='ORIGINAL_TEST_FIRST_PHOTO_DISPATCH_ACQUIRED'
  ||resumed.package_id!==testPackageId||resumed.worker_id!==s.worker_id
  ||resumed.generation!==1||resumed.folder_plan_id!==s.folder_plan_id
  ||resumed.photo_plan_id!==s.photo_plan_id
  ||resumed.folder_remote_id!==s.folder_remote_id
  ||resumed.photo_remote_id!==s.photo_remote_id
  ||resumed.dispatch_id!==request
  ||typeof resumed.expires_at!=='string'
  ||Date.parse(resumed.expires_at)<=Date.now())
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_DISPATCH_UNVERIFIED');
 const next=await ledger.nextReservedItem(testPackageId,s.worker_id,1);
 if(next?.state!=='FILE'||next.kind!=='PHOTO'||next.plan_id!==s.photo_plan_id)
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_QUEUE_CHANGED');
 const outcome=await continueFile({
  tokenProvider:async()=>token,ledger,workerId:s.worker_id,generation:1,
  packageId:testPackageId,planId:s.photo_plan_id,
  expectedEmail,expectedDriveId,projectUrl,serviceRoleJwt,vault,fetcher
 });
 if(outcome?.plan_id!==s.photo_plan_id
  ||!['FILE_VERIFIED','PROGRESS'].includes(outcome.state))
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_RESULT_UNVERIFIED');
 const nextAfter=await ledger.nextReservedItem(testPackageId,s.worker_id,1);
 if(outcome.state==='FILE_VERIFIED'){
  if(nextAfter?.plan_id===s.photo_plan_id||nextAfter?.state==='UNRESERVED')
   throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_RECEIPT_MISSING');
 }else{
  if(nextAfter?.state!=='FILE'||nextAfter?.kind!=='PHOTO'
    ||nextAfter.plan_id!==s.photo_plan_id
    ||!Number.isSafeInteger(outcome.recorded_offset)
    ||outcome.recorded_offset<1||outcome.recorded_offset>s.photo_size)
   throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_PROGRESS_UNVERIFIED');
  const session=await ledger.forLease(testPackageId,s.worker_id,1)
    .getSession(s.photo_plan_id);
  if(!session||session.plan_id!==s.photo_plan_id
    ||session.package_id!==testPackageId||session.total_bytes!==s.photo_size
    ||session.recorded_offset<outcome.recorded_offset
    ||!session.encrypted)
   throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_SESSION_NOT_DURABLE');
 }
 const release=await ledger.releaseDispatch(request);
 if(release?.released!==true)
  throw new DriveUncertain('ORIGINAL_TEST_FIRST_PHOTO_PERMIT_UNVERIFIED');
 return Object.freeze({state:outcome.state==='FILE_VERIFIED'
   ?'ORIGINAL_TEST_FIRST_PHOTO_VERIFIED':'ORIGINAL_TEST_FIRST_PHOTO_PROGRESS_VERIFIED'});
}

export async function prepareTrustedDelivery({
  tokenProvider,ledger,workerId,expectedEmail,expectedDriveId,
  fetcher=fetch
}={}){
  if(typeof tokenProvider!=='function'||!ledger||!workerId
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||typeof expectedDriveId!=='string'||!expectedDriveId)
    throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  // Refresh BEFORE opening the durable DB lease. Wrong/expired Workspace
  // authorization cannot claim jobs or strand their pending outbox entry.
  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  // The preflight coordinator currently owns claim/reservations and refuses
  // to attempt Drive create or upload. Its output carries no bearer capability.
  const result=await reserveProviderIdentities({
    ledger,drive,workerId,expectedEmail,expectedDriveId
  });
  if(result.provider_writes_performed!==false && result.claimed!==false)
    throw new DriveUncertain('UNEXPECTED_PROVIDER_WRITE');
  return result;
}


/**
 * Trusted one-wakeup/one-parent-step coordinator. Recovery identity comes
 * ONLY from the durable, service-role fenced outbox; never from caller JSON.
 * This does NOT silently restart an expired/UNCERTAIN delivery or finish one.
 * Package/file continuation and final receipts remain separately gated.
 */
export async function advanceTrustedDeliveryOneStep({
  ledger,tokenProvider,makeWorkerId,expectedEmail,expectedDriveId,
  projectUrl,serviceRoleJwt,makeVault,fetcher=fetch
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const HASH=/^[a-f0-9]{64}$/;
  if(typeof ledger?.readActiveLease!=='function'
    ||typeof ledger?.claim!=='function'
    ||typeof ledger?.heartbeat!=='function'
    ||typeof makeWorkerId!=='function'
    ||typeof tokenProvider!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||typeof expectedDriveId!=='string'||!expectedDriveId
    ||typeof fetcher!=='function')
    throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  // A read is not an ownership transfer. Every subsequent reserved write is
  // checked against the current lease by the existing service-only RPC owner.
  const old=await ledger.readActiveLease();
  if(!old||!['ACTIVE','NONE','BLOCKED_UNCERTAIN'].includes(old.state))
    throw new DriveUncertain('ORIGINAL_LEASE_READ_UNCERTAIN');
  if(old.state==='BLOCKED_UNCERTAIN')
    throw new DriveUncertain('EXPIRED_DELIVERY_REQUIRES_RECONCILIATION');
  let workerId,originalClaim=null;
  if(old.state==='ACTIVE'){
    if(!UUID.test(old.package_id??'')||!UUID.test(old.worker_id??'')
      ||!Number.isSafeInteger(old.generation)||old.generation<1
      ||!UUID.test(old.destination_id??'')
      ||!HASH.test(old.approved_sha256??'')
      ||old.manifest?.package_id!==old.package_id
      ||old.manifest?.destination_id!==old.destination_id)
      throw new DriveUncertain('ORIGINAL_LEASE_READ_UNCERTAIN');
    workerId=old.worker_id;
    originalClaim={claimed:true,package_id:old.package_id,
      generation:old.generation,destination_id:old.destination_id,
      approved_sha256:old.approved_sha256,manifest:old.manifest};
  }else{
    workerId=makeWorkerId();
    if(!UUID.test(workerId??''))
      throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  }
  // Once immutable file reservations exist, bypass preallocation entirely.
  // The original server lease alone selects the next plan; never generate a
  // replacement Google ID or trust package/plan IDs from request JSON.
  if(originalClaim!==null){
    if(typeof ledger.nextReservedItem!=='function')
      throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
    const item=await ledger.nextReservedItem(
      originalClaim.package_id,workerId,originalClaim.generation);
    if(!item||!['UNRESERVED','FOLDER','FILE',
      'RECEIPTS_READY_FOR_FINAL_RECHECK'].includes(item.state))
      throw new DriveUncertain('FROZEN_DELIVERY_ITEM_UNVERIFIED');
    if(item.state==='RECEIPTS_READY_FOR_FINAL_RECHECK'){
      if(typeof ledger.finalProviderSnapshot!=='function'
        ||typeof ledger.finish!=='function')
        throw new DriveUncertain('FINAL_PROVIDER_RECHECK_NOT_CONFIGURED');
      const pkg=originalClaim.package_id,gen=originalClaim.generation;
      const frozen=originalClaim.manifest;
      const snap=await ledger.finalProviderSnapshot(pkg,workerId,gen);
      const layout=frozen.folder_layout??'ADDRESS_WORK_ORDER';
      const sequence=layout==='ADDRESS_WORK_ORDER'?['WORK_ORDER','ADDRESS']
        :layout==='STATE_CITY_ADDRESS'?['WORK_ORDER','ADDRESS','CITY','STATE']
        :layout==='STATE_COUNTY_CITY_ADDRESS'
          ?['WORK_ORDER','ADDRESS','CITY','COUNTY','STATE']:null;
      const id=/^[A-Za-z0-9_-]{10,160}$/;
      const sha=/^[a-f0-9]{64}$/;
      const photos=frozen.selected_photos;
      if(!sequence||snap?.package_id!==pkg
        ||snap?.approved_sha256!==originalClaim.approved_sha256
        ||snap?.destination_id!==originalClaim.destination_id
        ||snap?.root_id!==frozen.destination_root
        ||!id.test(snap?.root_id??'')
        ||!Array.isArray(snap.ancestors)||snap.ancestors.length!==sequence.length
        ||!Array.isArray(snap.files)||snap.files.length!==photos.length+2
        ||snap.files.length>202)
        throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
      const identity={
        fwh_package:pkg,fwh_manifest:originalClaim.approved_sha256
      };
      const used=new Set([snap.root_id]);
      let requiredParent=snap.files[0]?.parent;
      for(let i=0;i<snap.ancestors.length;i++){
        const p=snap.ancestors[i];
        if(!p||!id.test(p.id??'')||!id.test(p.parent??'')
          ||p.id!==requiredParent||used.has(p.id)
          ||p.mime!=='application/vnd.google-apps.folder'
          ||p.sha256!==null||p.size!==null
          ||p.appProperties?.fwh_kind!==sequence[i]
          ||p.appProperties?.fwh_destination!==originalClaim.destination_id
          ||p.appProperties?.fwh_org!==frozen.organization_id
          ||p.appProperties?.fwh_company!==frozen.client_company_id
          ||Object.keys(p.appProperties).length!==5)
          throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
        used.add(p.id);requiredParent=p.parent;
      }
      if(requiredParent!==snap.root_id)
        throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
      const folder=snap.files[0];
      if(!folder||!id.test(folder.id??'')||used.has(folder.id)
        ||folder.parent!==snap.ancestors[0].id
        ||folder.name!=='package-'+pkg
        ||folder.mime!=='application/vnd.google-apps.folder'
        ||folder.sha256!==null||folder.size!==null)
        throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
      used.add(folder.id);
      const photoSet=new Map(photos.map(p=>[
        'field-photo-'+p.photo_id+'.jpg',p]));
      const seenPhotos=new Set();
      for(let i=0;i<snap.files.length;i++){
        const f=snap.files[i];
        if(!f||!id.test(f.id??'')||i>0&&(used.has(f.id)||f.parent!==folder.id)
          ||f.appProperties?.fwh_package!==identity.fwh_package
          ||f.appProperties?.fwh_manifest!==identity.fwh_manifest
          ||Object.keys(f.appProperties).length!==2)
          throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
        if(i===0)continue;
        used.add(f.id);
        if(f.name==='submission.json'){
          if(i!==snap.files.length-1
            ||f.mime!=='application/json'
            ||f.sha256!==identity.fwh_manifest
            ||!Number.isSafeInteger(f.size)||f.size<=0)
            throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
        }else{
          const photo=photoSet.get(f.name);
          if(!photo||seenPhotos.has(f.name)||f.mime!=='image/jpeg'
            ||!sha.test(f.sha256??'')
            ||f.sha256!==photo.observed_sha256
            ||f.size!==photo.observed_size)
            throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
          seenPhotos.add(f.name);
        }
      }
      if(seenPhotos.size!==photos.length)
        throw new DriveUncertain('FINAL_PROVIDER_SNAPSHOT_UNVERIFIED');
      // The final stage is READ-ONLY at Google: fresh GETs of every frozen
      // ancestor and remote byte receipt. No stale stored SQL receipt alone
      // can reach the final database transition from this coordinator.
      let auth;
      try{auth=await tokenProvider();}
      catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
      if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
        ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
        throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
      const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
      const account=await drive.verifyProviderIdentity(expectedEmail);
      if(account.account.toLowerCase()!==expectedEmail.toLowerCase())
        throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
      const beat=()=>ledger.heartbeat(pkg,workerId,gen);
      await beat();
      await drive.verifyDestination({folderId:snap.root_id,expectedDriveId});
      for(const item of [...snap.ancestors,...snap.files]){
        await beat();
        await drive.verifyFile({...item,expectedDriveId});
      }
      await beat();
      const result=await ledger.finish(pkg,workerId,gen);
      if(result?.package_id!==pkg||result?.status!=='DELIVERED'
        ||result?.manifest_sha256!==originalClaim.approved_sha256
        ||result?.verified_file_count!==photos.length+2)
        throw new DriveUncertain('FINAL_PROVIDER_RECEIPT_UNVERIFIED');
      return Object.freeze({state:'PACKAGE_DELIVERED'});
    }
    if(item.state==='FOLDER'||item.state==='FILE'){
      if(!UUID.test(item.plan_id??'')
        ||(item.state==='FILE'&&!['PHOTO','MANIFEST'].includes(item.kind))
        ||(item.state==='FOLDER'&&item.kind!==undefined))
        throw new DriveUncertain('FROZEN_DELIVERY_ITEM_UNVERIFIED');
      const lease={tokenProvider,ledger,workerId,
        generation:originalClaim.generation,packageId:originalClaim.package_id,
        planId:item.plan_id,expectedEmail,expectedDriveId,fetcher};
      if(item.state==='FOLDER'){
        const result=await continueTrustedPackageFolder(lease);
        if(result?.state!=='FOLDER_VERIFIED'||result.plan_id!==item.plan_id)
          throw new DriveUncertain('FROZEN_DELIVERY_ITEM_UNVERIFIED');
        return Object.freeze({state:'PACKAGE_FOLDER_STEP_VERIFIED'});
      }
      // Private source, encryption and the exact current lease are mandatory.
      // A missing backend credential stops before any OAuth/Google operation.
      if(typeof projectUrl!=='string'||!projectUrl
        ||typeof serviceRoleJwt!=='string'||!serviceRoleJwt
        ||typeof makeVault!=='function')
        throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
      const vault=await makeVault();
      if(!vault)throw new DriveUncertain('SESSION_KEY_NOT_CONFIGURED');
      const result=await continueTrustedDeliveryFile({
        ...lease,projectUrl,serviceRoleJwt,vault
      });
      if(result?.state==='FILE_VERIFIED')
        return Object.freeze({state:'FILE_STEP_VERIFIED'});
      if(['PROGRESS','NEEDS_INDEPENDENT_GET'].includes(result?.state))
        return Object.freeze({state:'FILE_STEP_PENDING'});
      throw new DriveUncertain('FROZEN_DELIVERY_ITEM_UNVERIFIED');
    }
  }
  // Capture only the server-returned frozen manifest to decide which existing
  // parent owner applies. Never accept a browser-selected folder layout.
  let frozen=null;
  const scopedLedger={
    ...ledger,
    claim:async requested=>{
      if(requested!==workerId)
        throw new DriveUncertain('ORIGINAL_LEASE_READ_UNCERTAIN');
      const result=originalClaim??await ledger.claim(workerId);
      if(result?.claimed===true)frozen=result.manifest;
      return result;
    }
  };
  const staged=await prepareTrustedDelivery({
    tokenProvider,ledger:scopedLedger,workerId,
    expectedEmail,expectedDriveId,fetcher
  });
  if(staged?.claimed===false)return Object.freeze({state:'NO_ELIGIBLE_PACKAGES'});
  if(staged?.claimed!==true||!UUID.test(staged.package_id??'')
    ||!Number.isSafeInteger(staged.generation)||staged.generation<1
    ||(originalClaim!==null&&(staged.package_id!==originalClaim.package_id
      ||staged.generation!==originalClaim.generation))
    ||staged.provider_writes_performed!==false)
    throw new DriveUncertain('FROZEN_LEASE_OR_PLAN_UNVERIFIED');
  const kind=staged.next_parent_kind;
  if(kind===undefined){
    // Immutable package/file IDs are now prepared, but real upload and
    // terminal delivery are NOT performed by this bounded parent coordinator.
    return Object.freeze({state:'PACKAGE_IDENTITIES_PREALLOCATED'});
  }
  if(!['STATE','COUNTY','CITY','ADDRESS','WORK_ORDER'].includes(kind)
    ||!frozen||!['ADDRESS_WORK_ORDER','STATE_COUNTY_CITY_ADDRESS',
      'STATE_CITY_ADDRESS'].includes(frozen.folder_layout??'ADDRESS_WORK_ORDER'))
    throw new DriveUncertain('FROZEN_LEASE_OR_PLAN_UNVERIFIED');
  const layout=frozen.folder_layout??'ADDRESS_WORK_ORDER';
  const lease={tokenProvider,ledger,workerId,generation:staged.generation,
    packageId:staged.package_id,expectedEmail,expectedDriveId,fetcher,kind};
  let done;
  if(layout==='ADDRESS_WORK_ORDER'||['STATE','COUNTY','CITY'].includes(kind))
    done=await continueTrustedDeliveryParent(lease);
  else
    done=await continueTrustedGeographicLeaf(lease);
  if(done?.state!=='PARENT_VERIFIED'||done.kind!==kind)
    throw new DriveUncertain('FROZEN_PARENT_UNVERIFIED');
  return Object.freeze({state:'PARENT_STEP_VERIFIED'});
}

/**
 * Candidate continuation of the SAME worker's existing, preallocated file.
 * It does not claim work, create new Google IDs/folders, finish a package,
 * schedule itself or make this endpoint callable from an app/browser.
 * A disposable TEST provider and real protected-Storage reads remain a gate.
 */
export async function continueTrustedDeliveryFile({
  tokenProvider, ledger, workerId, generation, packageId, planId,
  expectedEmail, expectedDriveId, projectUrl, serviceRoleJwt, fetcher=fetch,
  vault
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(!UUID.test(workerId??'')||!UUID.test(packageId??'')||!UUID.test(planId??'')
    ||!Number.isSafeInteger(generation)||generation<1
    ||typeof tokenProvider!=='function'||typeof ledger?.forLease!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||typeof expectedDriveId!=='string'||!expectedDriveId
    ||!vault||typeof fetcher!=='function')
    throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  const scoped=ledger.forLease(packageId,workerId,generation);
  // The frozen file source is private, and every projection is fenced by
  // original package, worker and lease generation in the existing SQL owner.
  const readProtectedChunk=createPrivateSourceChunkReader({
    projectUrl,serviceRoleJwt,ledger:scoped,fetcher
  });
  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  const account=await drive.verifyProviderIdentity(expectedEmail);
  if(account.account.toLowerCase()!==expectedEmail.toLowerCase())
    throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
  await scoped.heartbeat(packageId,workerId,generation);
  const plan=await scoped.getFilePlan(planId);
  if(!plan||plan.package_id!==packageId||plan.plan_id!==planId
    ||!['PHOTO','MANIFEST'].includes(plan.kind)
    ||typeof plan.parent_id!=='string'
    ||!plan.parent_id)
    throw new DriveUncertain('EXACT_PREALLOCATED_FILE_REQUIRED');
  // The already-created immutable package folder, never the company's
  // internal Shared Drive or a client-provided parent, is checked with the
  // real provider OAuth token on every continuation.
  await drive.verifyDestination({folderId:plan.parent_id,expectedDriveId});
  await scoped.heartbeat(packageId,workerId,generation);
  return transferOnePreparedChunk({
    plan,workerId,generation,drive,ledger:scoped,vault,readProtectedChunk,
    expectedDriveId
  });
}

/**
 * Source-only continuation for the immutable PACKAGE folder. The current
 * lease and independently fetched folder plan are mandatory; a caller may
 * not supply a folder ID, name, parent, or mutable appProperties.
 * This is NOT wired to the public Edge entrypoint or a scheduler.
 */
export async function continueTrustedPackageFolder({
  tokenProvider,ledger,workerId,generation,packageId,planId,
  expectedEmail,expectedDriveId,fetcher=fetch
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(!UUID.test(workerId??'')||!UUID.test(packageId??'')||!UUID.test(planId??'')
    ||!Number.isSafeInteger(generation)||generation<1
    ||typeof tokenProvider!=='function'||typeof ledger?.forLease!=='function'
    ||typeof expectedEmail!=='string'||!expectedEmail
    ||typeof expectedDriveId!=='string'||!expectedDriveId
    ||typeof fetcher!=='function')
    throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  const account=await drive.verifyProviderIdentity(expectedEmail);
  if(account.account.toLowerCase()!==expectedEmail.toLowerCase())
    throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
  const scoped=ledger.forLease(packageId,workerId,generation);
  await scoped.heartbeat(packageId,workerId,generation);
  const plan=await scoped.getFolderPlan(planId);
  if(!plan||plan.package_id!==packageId||plan.plan_id!==planId)
    throw new DriveUncertain('EXACT_PREALLOCATED_FOLDER_REQUIRED');
  return reconcileOnePreallocatedPackageFolder({
    plan,workerId,generation,drive,ledger:scoped,expectedDriveId
  });
}

/**
 * Source-only STATE / COUNTY / CITY / ADDRESS / WORK_ORDER continuation. The map is obtained from the
 * original SQL lease and never supplied by the caller. No public handler
 * invokes this function while provider readiness remains disabled.
 */
export async function continueTrustedDeliveryParent({
 tokenProvider,ledger,workerId,generation,packageId,kind,
 expectedEmail,expectedDriveId,fetcher=fetch
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!UUID.test(workerId??'')||!UUID.test(packageId??'')
  ||!Number.isSafeInteger(generation)||generation<1
  ||!['STATE','COUNTY','CITY','ADDRESS','WORK_ORDER'].includes(kind)
  ||typeof tokenProvider!=='function'||typeof ledger?.readParent!=='function'
  ||typeof expectedEmail!=='string'||!expectedEmail
  ||typeof expectedDriveId!=='string'||!expectedDriveId)
  throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
 let auth;
 try{auth=await tokenProvider();}
 catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
  ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
  throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
 const account=await drive.verifyProviderIdentity(expectedEmail);
 if(account.account.toLowerCase()!==expectedEmail.toLowerCase())
  throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
 await ledger.heartbeat(packageId,workerId,generation);
 const map=await ledger.readParent(packageId,workerId,generation,kind);
 if(map?.exists!==true||map.kind!==kind)
  throw new DriveUncertain('EXACT_PREALLOCATED_PARENT_REQUIRED');
 return reconcileOnePreallocatedParent({
  map,packageId,workerId,generation,drive,ledger,expectedDriveId
 });
}

/**
 * Provider-disabled candidate continuation for geographic ADDRESS/WORK_ORDER.
 * Its distinct scoped SQL lookup cannot silently fall back to the legacy
 * Address-under-client-root layout. Same original one-shot parent journal.
 */
export async function continueTrustedGeographicLeaf({
 tokenProvider,ledger,workerId,generation,packageId,kind,
 expectedEmail,expectedDriveId,fetcher=fetch
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!UUID.test(workerId??'')||!UUID.test(packageId??'')
  ||!Number.isSafeInteger(generation)||generation<1
  ||!['ADDRESS','WORK_ORDER'].includes(kind)
  ||typeof tokenProvider!=='function'
  ||typeof ledger?.readGeographicLeaf!=='function'
  ||typeof ledger?.heartbeat!=='function'
  ||typeof expectedEmail!=='string'||!expectedEmail
  ||typeof expectedDriveId!=='string'||!expectedDriveId
  ||typeof fetcher!=='function')
   throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
 let auth;
 try{auth=await tokenProvider();}
 catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
  ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
  throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
 const account=await drive.verifyProviderIdentity(expectedEmail);
 if(account.account.toLowerCase()!==expectedEmail.toLowerCase())
  throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
 await ledger.heartbeat(packageId,workerId,generation);
 const map=await ledger.readGeographicLeaf(packageId,workerId,generation,kind);
 if(map?.exists!==true||map.kind!==kind)
  throw new DriveUncertain('EXACT_PREALLOCATED_GEOGRAPHIC_LEAF_REQUIRED');
 // The same reconciler validates the server-fetched remote ID, company
 // appProperties, expected Shared Drive, original create attempt, and GET.
 // Re-read the exact geographic leaf under its strict, server-authorized
 // path. Legacy readParent uses a different ADDRESS/WO map and must not
 // silently replace the geographic lookup at the provider receipt gate.
 const geographicLedger={
  ...ledger,
  readParent:(p,w,g,k)=>{
   if(k!==kind)throw new DriveUncertain('EXACT_GEOGRAPHIC_LEAF_REQUIRED');
   return ledger.readGeographicLeaf(p,w,g,k);
  }
 };
 return reconcileOnePreallocatedParent({
  map,packageId,workerId,generation,drive,
  ledger:geographicLedger,expectedDriveId
 });
}


// Phase 5A/D source candidate: read-only Google account/root proof for an
// existing *INACTIVE* server-side client proposal. The two service RPCs are
// deliberately not present in the hosted TEST-only verifier until their
// canonical SQL migrations, current team scope and private TEST configuration
// are staged. No public/browser operation or activation is introduced.
export async function preflightInactiveClientDestination({
  ledger, tokenProvider, actionId, destinationId, organizationId, companyId,
  expectedEmail, expectedDriveId, expectedRootId, internalDriveId,
  testEvidenceClass, fetcher=fetch
}={}){
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ID=/^[A-Za-z0-9_-]{10,160}$/;
  if(testEvidenceClass!=='DISPOSABLE_FWH_TEST_ONLY'
    ||![actionId,destinationId,organizationId,companyId].every(x=>UUID.test(x??''))
    ||typeof expectedEmail!=='string'||!/^[-._+a-z0-9]+@[-.a-z0-9]+\.[a-z]{2,}$/i.test(expectedEmail)
    ||expectedEmail!==expectedEmail.toLowerCase()
    ||![expectedRootId,expectedDriveId,internalDriveId].every(x=>ID.test(x??''))
    ||new Set([expectedRootId,expectedDriveId,internalDriveId]).size!==3
    ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
    ||typeof ledger?.readClientDestination!=='function'
    ||typeof ledger?.recordClientDestinationPreflight!=='function')
    throw new DriveUncertain('TEST_CLIENT_DESTINATION_PREFLIGHT_NOT_CONFIGURED');
  // Never get org, client or root authority from a browser request.
  const candidate=await ledger.readClientDestination(destinationId);
  if(!candidate||candidate.destination_id!==destinationId
    ||candidate.organization_id!==organizationId
    ||candidate.company_id!==companyId
    ||!UUID.test(candidate.revision??'')
    ||candidate.provider!=='GOOGLE_DRIVE'
    ||candidate.provider_identity!==expectedEmail
    ||candidate.root_folder_id!==expectedRootId
    ||candidate.verified!==false||candidate.active!==false)
    throw new DriveUncertain('TEST_CLIENT_DESTINATION_SCOPE_MISMATCH');
  // Provider operations are GET only. No file ID generation/create/send.
  let auth;
  try{auth=await tokenProvider();}
  catch{throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');}
  if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
    ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
    throw new DriveUncertain('WORKSPACE_AUTHORIZATION_REQUIRED');
  const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
  const verifiedAccount=await drive.verifyProviderIdentity(expectedEmail);
  const verifiedRoot=await drive.verifyDestination({
    folderId:expectedRootId,expectedDriveId
  });
  if(verifiedAccount.account!==expectedEmail
    ||verifiedRoot.id!==expectedRootId
    ||verifiedRoot.drive_id!==expectedDriveId
    ||verifiedRoot.can_add_children!==true)
    throw new DriveUncertain('TEST_CLIENT_DESTINATION_PROVIDER_MISMATCH');
  // Failure after a trusted POST is ambiguous. The original action UUID must
  // be retained and replayed, never replaced with a new proposal/identity.
  const result=await ledger.recordClientDestinationPreflight(
    actionId,candidate,verifiedRoot.drive_id);
  if(result?.destination_id!==destinationId||result.company_id!==companyId
    ||result.preflight_recorded!==true||result.verified!==false
    ||result.active!==false||typeof result.replayed!=='boolean')
    throw new DriveUncertain('TEST_CLIENT_DESTINATION_RECEIPT_UNVERIFIED');
  return Object.freeze({status:'CLIENT_DESTINATION_PREFLIGHT_RECORDED',
    destination_id:destinationId,company_id:companyId,
    provider_read_verified:true,preflight_recorded:true,
    verified:false,active:false,replayed:result.replayed});
}


/**
 * Source-only TEST proof; same trusted-worker/Drive/ledger owners as Phase 5D.
 * First invocation may create ONE disposable, company-bound proof folder only
 * after the exact Google ID has been durably reserved by service RPC.
 * Any crash/ambiguous result: subsequent invocations GET/LIST the reserved ID;
 * never retry the POST, generate an alternate ID, Send, or activate delivery.
 */
export async function proveInactiveClientDestinationFolder({
 ledger,tokenProvider,actionId,preflightActionId,destinationId,
 organizationId,companyId,expectedEmail,expectedDriveId,expectedRootId,
 internalDriveId,testEvidenceClass,allowProviderCreate=false,fetcher=fetch
}={}){
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const ID=/^[A-Za-z0-9_-]{10,160}$/;
 const fail=code=>{throw new DriveUncertain(code);};
 if(testEvidenceClass!=='DISPOSABLE_FWH_TEST_ONLY'
  ||![actionId,preflightActionId,destinationId,organizationId,companyId]
    .every(x=>UUID.test(x??''))
  ||typeof expectedEmail!=='string'||expectedEmail!==expectedEmail.toLowerCase()
  ||!/^[-._+a-z0-9]+@[-.a-z0-9]+\.[a-z]{2,}$/.test(expectedEmail)
  ||![expectedDriveId,expectedRootId,internalDriveId].every(x=>ID.test(x??''))
  ||new Set([expectedDriveId,expectedRootId,internalDriveId]).size!==3
  ||typeof ledger?.readClientDestinationProviderProof!=='function'
  ||typeof ledger?.readClientDestination!=='function'
  ||typeof ledger?.reserveClientDestinationProviderProof!=='function'
  ||typeof ledger?.confirmClientDestinationProviderProof!=='function'
  ||typeof ledger?.recordClientDestinationPreflight!=='function'
  ||typeof tokenProvider!=='function'||typeof fetcher!=='function'
  ||typeof allowProviderCreate!=='boolean')
  fail('TEST_CLIENT_PROOF_NOT_CONFIGURED');
 // Read before generating IDs. The service RPC rejects active, stale-revision
 // or moved company/Drive candidates, and retains the original reserved ID.
 const existing=await ledger.readClientDestinationProviderProof(destinationId);
 if(!existing||typeof existing.exists!=='boolean')
  fail('CLIENT_PROOF_RESERVATION_UNCERTAIN');
 const validatePlan=(p,completed=false)=>{
  const exactName='FWH DISPOSABLE CLIENT PROOF '+actionId.replaceAll('-','').slice(0,12);
  if(p?.destination_id!==destinationId||p?.organization_id!==organizationId
   ||p?.company_id!==companyId||p?.root_folder_id!==expectedRootId
   ||p?.drive_id!==expectedDriveId||p?.folder_name!==exactName
   ||p?.action_id!==actionId||p?.preflight_action_id!==preflightActionId
   ||p?.provider_identity!==expectedEmail||!UUID.test(p.revision??'')
   ||!ID.test(p.folder_id??'')||p.folder_id===expectedRootId
   ||p.folder_id===expectedDriveId
   ||(completed&&p.completed!==true))
    fail('CLIENT_PROOF_RESERVATION_MISMATCH');
 };
 if(existing.exists){
  validatePlan(existing);
  if(existing.completed===true)
   return Object.freeze({status:'CLIENT_DESTINATION_VERIFIED_INACTIVE',
    destination_id:destinationId,company_id:companyId,
    verified:true,active:false,replayed:true,provider_writes_performed:false});
  if(existing.completed!==false)fail('CLIENT_PROOF_RESERVATION_UNCERTAIN');
 }else if(allowProviderCreate!==true){
  fail('CLIENT_PROOF_CREATION_NOT_AUTHORIZED');
 }
 // Only an inactive exact matching server proposal can pass this preflight,
 // even if the caller already has a reservation from a previous request.
 const preflight=await preflightInactiveClientDestination({
  ledger,tokenProvider,actionId:preflightActionId,destinationId,
  organizationId,companyId,expectedEmail,expectedDriveId,expectedRootId,
  internalDriveId,testEvidenceClass,fetcher
 });
 if(preflight.preflight_recorded!==true||preflight.active!==false
    ||preflight.verified!==false)
   fail('CLIENT_PROOF_ROOT_PREFLIGHT_UNVERIFIED');
 const candidate=await ledger.readClientDestination(destinationId);
 if(!candidate||candidate.destination_id!==destinationId
  ||candidate.organization_id!==organizationId||candidate.company_id!==companyId
  ||candidate.root_folder_id!==expectedRootId
  ||candidate.provider_identity!==expectedEmail
  ||!UUID.test(candidate.revision??'')
  ||candidate.active!==false||candidate.verified!==false)
  fail('CLIENT_PROOF_SCOPE_MISMATCH');
 let auth;
 try{auth=await tokenProvider();}
 catch{fail('WORKSPACE_AUTHORIZATION_REQUIRED');}
 if(typeof auth?.accessToken!=='string'||auth.accessToken.length<20
  ||!Number.isInteger(auth.expiresInSeconds)||auth.expiresInSeconds<60)
  fail('WORKSPACE_AUTHORIZATION_REQUIRED');
 const drive=createDriveClient({accessToken:auth.accessToken,fetcher});
 await drive.verifyProviderIdentity(expectedEmail);
 await drive.verifyDestination({folderId:expectedRootId,expectedDriveId});
 let plan=existing;
 let mayPost=false;
 if(!existing.exists){
  const [id]=await drive.generateIds(1);
  if(!ID.test(id??'')||id===expectedRootId||id===expectedDriveId)
   fail('CLIENT_PROOF_NEW_ID_INVALID');
  // If reservation commit/response is uncertain, STOP and read it next time.
  // There is no Google POST before durable successful reservation response.
  plan=await ledger.reserveClientDestinationProviderProof(
    actionId,preflightActionId,candidate,id,expectedDriveId);
  if(plan?.reserved!==true||typeof plan.replayed!=='boolean'
    ||plan.folder_id!==id||plan.destination_id!==destinationId
    ||plan.organization_id!==organizationId||plan.company_id!==companyId
    ||plan.root_folder_id!==expectedRootId||plan.drive_id!==expectedDriveId)
    fail('CLIENT_PROOF_RESERVATION_UNCERTAIN');
  mayPost=!plan.replayed;
 }else{
  // Saved reservation must NEVER create another remote object, even when the
  // first request was interrupted before its create HTTP response.
  if(plan.folder_id===undefined)fail('CLIENT_PROOF_RESERVATION_UNCERTAIN');
 }
 const name='FWH DISPOSABLE CLIENT PROOF '+actionId.replaceAll('-','').slice(0,12);
 if(plan.folder_name!==name||!ID.test(plan.folder_id??''))
  fail('CLIENT_PROOF_RESERVATION_MISMATCH');
 const spec={id:plan.folder_id,parent:expectedRootId,name,
  mime:'application/vnd.google-apps.folder',
  appProperties:{fwh_org:organizationId,fwh_company:companyId,
   fwh_destination:destinationId,fwh_kind:'ADDRESS',fwh_key:actionId}};
 if(mayPost){
  try{await drive.createPreallocatedFolder(spec);}
  catch{/* An ambiguous POST can only be resolved by same-ID GET/LIST below. */}
 }
 // A Google files.create response is NEVER enough. Both independent reads
 // must prove the exact original ID/parent/Drive/name/appProperties.
 const proof=await drive.verifyFile({id:spec.id,parent:spec.parent,mime:spec.mime,
  name:spec.name,expectedDriveId,sha256:null,size:null,
  appProperties:spec.appProperties});
 if(proof.trashed!==false||proof.drive_id!==expectedDriveId)
  fail('CLIENT_PROOF_REMOTE_IDENTITY_UNVERIFIED');
 const listed=await drive.lookupExactFolder({id:spec.id,parent:spec.parent,
  name:spec.name,expectedDriveId,appProperties:spec.appProperties});
 if(listed.readback_verified!==true||listed.id!==spec.id
  ||listed.drive_id!==expectedDriveId)
  fail('CLIENT_PROOF_REMOTE_LIST_UNVERIFIED');
 const receipt=await ledger.confirmClientDestinationProviderProof(
  actionId,preflightActionId,candidate,spec.id,expectedDriveId);
 if(receipt?.destination_id!==destinationId||receipt.verified!==true
  ||receipt.active!==false||typeof receipt.replayed!=='boolean')
  fail('CLIENT_PROOF_RECEIPT_UNVERIFIED');
 return Object.freeze({status:'CLIENT_DESTINATION_VERIFIED_INACTIVE',
  destination_id:destinationId,company_id:companyId,
  verified:true,active:false,replayed:receipt.replayed,
  provider_writes_performed:mayPost});
}
