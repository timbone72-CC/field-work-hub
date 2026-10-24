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
  ledger,makeRequestId=()=>crypto.randomUUID(),
  makeDispatchId=()=>crypto.randomUUID(),testPackageId,
  testDestinationId,testRootId,...inspection
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(typeof ledger?.recoverAndAcquireDispatch!=='function'
    ||typeof makeRequestId!=='function'||typeof makeDispatchId!=='function')
    throw new DriveUncertain('RECOVERY_CAS_NOT_CONFIGURED');
  const report=await inspectExpiredReservedParent({
    ledger,testPackageId,testDestinationId,testRootId,...inspection
  });
  if(report.state!=='ORIGINAL_RESERVED_ID_NOT_FOUND')
    throw new DriveUncertain('ORIGINAL_REMOTE_ABSENCE_NOT_PROVED');
  const requestId=makeRequestId(),dispatchId=makeDispatchId();
  if(!UUID.test(requestId)||!UUID.test(dispatchId)||requestId===dispatchId)
    throw new DriveUncertain('RECOVERY_CAS_NOT_CONFIGURED');
  const resumed=await ledger.recoverAndAcquireDispatch({
    package_id:report.package_id,destination_id:testDestinationId,
    root_id:testRootId,worker_id:report.worker_id,
    generation:report.generation,map_id:report.map_id,
    remote_folder_id:report.remote_folder_id,
    lease_until:report.lease_until,observed_at:report.observed_at,
    request_id:requestId,dispatch_id:dispatchId
  });
  if(resumed?.status!=='ORIGINAL_TEST_LEASE_AND_DISPATCH_ACQUIRED'
    ||resumed.dispatch_id!==dispatchId
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
    dispatch_id:dispatchId});
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
  makeDispatchId=()=>crypto.randomUUID(),
  fetcher=fetch
}={}){
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const required=['readExpiredReservation','recoverAndAcquireDispatch',
    'releaseDispatch','heartbeat','readParent',
    'beginParentCreate','confirmParent'];
  if(!ledger||required.some(k=>typeof ledger[k]!=='function')
    ||typeof tokenProvider!=='function'
    ||typeof makeDispatchId!=='function')
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
    testPackageId,testDestinationId,testRootId,makeRequestId,
    makeDispatchId,fetcher
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
