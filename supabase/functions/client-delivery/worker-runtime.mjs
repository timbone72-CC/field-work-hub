// Trusted-worker composition for preflight ONLY. This module creates NO
// external files, never schedules itself, and cannot mark a package Delivered.
// Until real provider evidence passes the phase gate, readiness stays OFF.
import {createDriveClient,DriveUncertain} from './drive-client.mjs';
import {reserveProviderIdentities} from './worker-core.mjs';
import {createPrivateSourceChunkReader} from './private-source.mjs';
import {transferOnePreparedChunk} from './upload-one.mjs';
import {reconcileOnePreallocatedPackageFolder} from './folder-one.mjs';
import {reconcileOnePreallocatedParent} from './parent-one.mjs';
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
  ||receipt.active!==false||typeof receipt.replayed!=='boolean)
  fail('CLIENT_PROOF_RECEIPT_UNVERIFIED');
 return Object.freeze({status:'CLIENT_DESTINATION_VERIFIED_INACTIVE',
  destination_id:destinationId,company_id:companyId,
  verified:true,active:false,replayed:receipt.replayed,
  provider_writes_performed:mayPost});
}
