// Trusted-worker composition for preflight ONLY. This module creates NO
// external files, never schedules itself, and cannot mark a package Delivered.
// Until real provider evidence passes the phase gate, readiness stays OFF.
import {createDriveClient,DriveUncertain} from './drive-client.mjs';
import {reserveProviderIdentities} from './worker-core.mjs';
import {createPrivateSourceChunkReader} from './private-source.mjs';
import {transferOnePreparedChunk} from './upload-one.mjs';
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
    plan,workerId,generation,drive,ledger:scoped,vault,readProtectedChunk
  });
}
