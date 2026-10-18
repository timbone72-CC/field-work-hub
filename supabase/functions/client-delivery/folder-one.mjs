// One preallocated *package* folder, never a second worker or a blind replay.
// Candidate source only: the fenced folder-plan/attempt RPCs and WO parent map
// must be implemented before any provider mutation can be enabled.
import {DriveUncertain} from './drive-client.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{10,160}$/;
const SHA=/^[0-9a-f]{64}$/;
function deny(){throw new DriveUncertain('FOLDER_IDENTITY_OR_LEASE_UNCERTAIN');}
function exact(plan){
  if(!plan||!UUID.test(plan.package_id??'')||!UUID.test(plan.plan_id??'')
    ||plan.kind!=='FOLDER'||plan.parent_kind!=='WORK_ORDER'
    ||!ID.test(plan.file_id??'')||!ID.test(plan.parent_id??'')
    ||plan.file_id===plan.parent_id
    ||plan.name!=='package-'+plan.package_id
    ||!UUID.test(plan.work_order_id??'')
    ||plan.mime!=='application/vnd.google-apps.folder'
    ||plan.sha256!==null||plan.size!==null
    ||plan.appProperties?.fwh_package!==plan.package_id
    ||!SHA.test(plan.appProperties?.fwh_manifest??'')
    ||!['PREALLOCATED','ATTEMPTED','VERIFIED'].includes(plan.state))
    deny();
}
function same(a,b){
  exact(a);exact(b);
  for(const k of ['package_id','plan_id','kind','parent_kind','file_id',
    'parent_id','name','work_order_id','mime','sha256','size']){
    if(a[k]!==b[k])deny();
  }
  if(a.appProperties.fwh_package!==b.appProperties.fwh_package
    ||a.appProperties.fwh_manifest!==b.appProperties.fwh_manifest)deny();
}
const RECEIPT=(plan,expectedDriveId)=>({id:plan.file_id,parent:plan.parent_id,mime:plan.mime,
  name:plan.name,expectedDriveId,sha256:null,size:null,appProperties:plan.appProperties});

/**
 * The ledger MUST implement current-lease-only RPCs:
 * getFolderPlan(planId), beginFolderCreate(planId) atomic one-shot CAS,
 * confirmFolder(plan,worker,generation,verified), and heartbeat.
 * beginFolderCreate must persist ATTEMPTED BEFORE returning MAY_CREATE,
 * including after a crash/timeout; retries may verify but never re-POST.
 *
 * The WO parent is already server-frozen, mapped to the exact client
 * destination and verified; a client-supplied/root parent is rejected.
 * This does not build the root/address/WO hierarchy or activate delivery.
 */
export async function reconcileOnePreallocatedPackageFolder({
  plan,workerId,generation,drive,ledger,expectedDriveId
}={}){
  exact(plan);
  if(!UUID.test(workerId??'')||!Number.isSafeInteger(generation)||generation<1
    ||!ID.test(expectedDriveId??'')
    ||typeof drive?.verifyDestination!=='function'
    ||typeof drive?.verifyFile!=='function'
    ||typeof drive?.createPreallocatedFolder!=='function'
    ||typeof ledger?.getFolderPlan!=='function'
    ||typeof ledger?.heartbeat!=='function'
    ||typeof ledger?.beginFolderCreate!=='function'
    ||typeof ledger?.confirmFolder!=='function')
    deny();
  const auth=()=>ledger.heartbeat(plan.package_id,workerId,generation);
  await auth();
  const current=await ledger.getFolderPlan(plan.plan_id);
  same(plan,current);
  // Any previous attempt (even a timed-out POST) is reconciled by its
  // EXISTING, immutable ID. 404/403 cannot prove safe absence.
  if(current.state!=='PREALLOCATED'){
    await auth();
    const checked=await drive.verifyFile(RECEIPT(current,expectedDriveId));
    await auth();
    await ledger.confirmFolder(current,workerId,generation,checked);
    return {state:'FOLDER_VERIFIED',plan_id:plan.plan_id};
  }
  // Recheck the exact already-mapped WO parent and client Shared Drive.
  await drive.verifyDestination({folderId:current.parent_id,expectedDriveId});
  await auth();
  const decision=await ledger.beginFolderCreate(plan.plan_id);
  // The authoritative one-shot attempt journal is durable BEFORE POST.
  if(!['MAY_CREATE','VERIFY_EXISTING'].includes(decision?.state)
    ||decision.plan_id!==plan.plan_id
    ||decision.file_id!==plan.file_id||decision.parent_id!==plan.parent_id)
    deny();
  // Another invocation may have recorded the same one-shot attempt after
  // our initial read. Never POST in this case; reconcile the original ID.
  if(decision.state==='VERIFY_EXISTING'){
    await auth();
    const checked=await drive.verifyFile(RECEIPT(current,expectedDriveId));
    await auth();
    await ledger.confirmFolder(current,workerId,generation,checked);
    return {state:'FOLDER_VERIFIED',plan_id:plan.plan_id};
  }
  await auth();
  await drive.createPreallocatedFolder({
    id:current.file_id,parent:current.parent_id,name:current.name,
    mime:current.mime,appProperties:current.appProperties
  });
  // POST success is NOT a receipt. Read back exact file, parent, MIME,
  // package/manifest properties and folder name with a separate GET.
  await auth();
  const checked=await drive.verifyFile(RECEIPT(current,expectedDriveId));
  await auth();
  await ledger.confirmFolder(current,workerId,generation,checked);
  return {state:'FOLDER_VERIFIED',plan_id:plan.plan_id};
}
