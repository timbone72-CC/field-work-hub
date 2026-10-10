// Trusted, source-only delivery *preflight and reservation* coordinator.
// Does NOT touch photo bytes, create folders, send clients or enable jobs.
// Run only after the protected OAuth provider identity + destination have been verified,
// with the service-role-only RPC adapter. No token/secret is accepted from browsers.
import { DriveUncertain } from './drive-client.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
export async function reserveProviderIdentities({ledger,drive,workerId,expectedEmail,expectedDriveId=null}){
  if(!UUID.test(workerId??'')||!ledger||!drive||!expectedEmail)
    throw new DriveUncertain('TRUSTED_WORKER_NOT_CONFIGURED');
  const claim=await ledger.claim(workerId);
  if(!claim||claim.claimed===false)return {claimed:false};
  if(claim.claimed!==true||!UUID.test(claim.package_id??'')
    ||!Number.isSafeInteger(claim.generation)||claim.generation<1
    ||!HASH.test(claim.approved_sha256??'')
    ||!claim.manifest||claim.manifest.package_id!==claim.package_id
    ||claim.manifest.destination_id!==claim.destination_id
    ||claim.manifest.review_policy_revision==null
    ||!Array.isArray(claim.manifest.selected_photos)
    ||claim.manifest.selected_photos.length>200)
    throw new DriveUncertain('FROZEN_CLAIM_INVALID');
  const photos=claim.manifest.selected_photos;
  const ids=new Set();
  for(const p of photos){
    if(!UUID.test(p.photo_id??'')||!HASH.test(p.observed_sha256??'')
      ||!Number.isSafeInteger(p.observed_size)||p.observed_size<=0
      ||ids.has(p.photo_id))throw new DriveUncertain('FROZEN_PHOTO_INVALID');
    ids.add(p.photo_id);
  }
  // No generated IDs, folder creation or bytes until BOTH checks pass.
  const verified=await drive.verifyProviderIdentity(expectedEmail);
  if(verified.account.toLowerCase()!==expectedEmail.toLowerCase())
    throw new DriveUncertain('WORKSPACE_ACCOUNT_MISMATCH');
  const destination=await drive.verifyDestination({
    folderId:claim.manifest.destination_root,expectedDriveId
  });
  if(destination.id!==claim.manifest.destination_root)
    throw new DriveUncertain('DESTINATION_NOT_VERIFIED');
  await ledger.heartbeat(claim.package_id,workerId,claim.generation);
  const preallocated=await drive.generateIds(photos.length+2);
  const folder=preallocated[0],manifestFile=preallocated[preallocated.length-1];
  // Reserve EVERY remote identity BEFORE any create/upload operation.
  await ledger.reserve(claim.package_id,workerId,claim.generation,
    'FOLDER',null,folder,destination.id);
  for(let i=0;i<photos.length;i++){
    await ledger.heartbeat(claim.package_id,workerId,claim.generation);
    await ledger.reserve(claim.package_id,workerId,claim.generation,
      'PHOTO',photos[i].photo_id,preallocated[i+1],folder);
  }
  await ledger.heartbeat(claim.package_id,workerId,claim.generation);
  await ledger.reserve(claim.package_id,workerId,claim.generation,
    'MANIFEST',null,manifestFile,folder);
  // Return safe work facts only. The provider token never leaves the adapter.
  return {claimed:true,package_id:claim.package_id,generation:claim.generation,
    reserved_count:photos.length+2,ready_for_provider_reconciliation:true,
    provider_writes_performed:false};
}
