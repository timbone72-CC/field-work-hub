// FWH-F04: one server-selected wake using the existing package-fenced worker.
// Never accept package/destination/root from an HTTP request or bypass SQL.
import {DriveUncertain} from './drive-client.mjs';
import {advancePinnedTestPackageOneStep} from './worker-runtime.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROOT=/^[A-Za-z0-9_-]{10,160}$/;

export async function advanceQueuedPackageOnce({
 ledger,runExisting=advancePinnedTestPackageOneStep,
 tokenProvider,expectedEmail,expectedDriveId,internalDriveId,
 projectUrl,serviceRoleJwt,makeVault,makeWorkerId,fetcher
}={}){
 if(typeof ledger?.selectNextDeliveryPackage!=='function'
   ||typeof runExisting!=='function')
   throw new DriveUncertain('PACKAGE_DISPATCH_SCOPE_INVALID');
 // This RPC is read-only and returns only server-frozen queued/owned IDs.
 // Actual claim, provider proof, single-flight and step guard remain in
 // advancePinnedTestPackageOneStep and its service-role SQL.
 const selected=await ledger.selectNextDeliveryPackage();
 if(selected?.available===false
   &&Object.keys(selected).length===1)
   return Object.freeze({state:'NO_ELIGIBLE_PACKAGES'});
 if(!selected||Array.isArray(selected)||selected.available!==true
   ||Object.keys(selected).sort().join(',')!==
      'available,destination_id,package_id,root_id'
   ||!UUID.test(selected.package_id??'')
   ||!UUID.test(selected.destination_id??'')
   ||!ROOT.test(selected.root_id??'')
   ||selected.root_id===expectedDriveId||selected.root_id===internalDriveId)
   throw new DriveUncertain('PACKAGE_DISPATCH_SCOPE_INVALID');
 return runExisting({
   ledger,packageId:selected.package_id,
   destinationId:selected.destination_id,rootId:selected.root_id,
   tokenProvider,expectedEmail,expectedDriveId,
   projectUrl,serviceRoleJwt,makeVault,makeWorkerId,fetcher
 });
}
